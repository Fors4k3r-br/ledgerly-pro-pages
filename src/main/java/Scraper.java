import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.reflect.TypeToken;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;

import java.io.IOException;
import java.io.Reader;
import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.text.Normalizer;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.ResolverStyle;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * Uso: java Scraper [caminho/do/config.properties]
 * Sem argumento, lê "config.properties" do diretório atual (se não existir, usa os padrões).
 */
public class Scraper {

    // data_com = coluna "Registro" do site; data_ex = coluna "Ex"
    record Provento(String tipo, String valor, String data_com, String data_ex, String pagamento) {}

    private record Config(
            String url,
            Path arquivoJson,
            Path arquivoTmp,
            String userAgent,
            int timeoutMs,
            int tentativas,
            double maxPercentualRejeitadas,
            boolean falharNoErro,
            List<String> colCodigo,
            List<String> colTipo,
            List<String> colValor,
            List<String> colRegistro,
            List<String> colEx,
            List<String> colPagamento,
            Pattern regexTicker,
            Pattern regexValor,
            DateTimeFormatter formatoData) {}

    private record Cache(String atualizadoEm, Map<String, List<Provento>> acoes, boolean legivel) {}

    private record Coleta(Map<String, List<Provento>> acoes, int linhasLidas, int rejeitadas) {}

    // Valores que o site usa quando a data de pagamento ainda não foi definida
    // (comparados em minúsculas e sem acento; \u2013 = "–", \u2014 = "—")
    private static final Set<String> PAGAMENTO_INDEFINIDO =
            Set.of("", "-", "\u2013", "\u2014", "n/d", "nd", "a definir");

    public static void main(String[] args) throws Exception {
        Path arquivoConfig = Path.of(args.length > 0 ? args[0] : "config.properties");
        Config cfg = carregarConfig(arquivoConfig);

        Gson gson = new GsonBuilder().setPrettyPrinting().serializeNulls().disableHtmlEscaping().create();
        String agora = Instant.now().toString();

        // 1. Carrega o cache anterior
        Cache cache = carregarCache(gson, cfg);

        // 2. Coleta, valida e faz merge com o cache
        Map<String, List<Provento>> acoes;
        String status;
        String atualizadoEm;
        String erro = null;
        int novos = 0;
        int atualizados = 0;

        try {
            Coleta coleta = coletarComTentativas(cfg);

            // ticker -> (chave do provento -> provento); o dado novo substitui o antigo
            Map<String, Map<String, Provento>> merge = new TreeMap<>();
            for (Map.Entry<String, List<Provento>> e : cache.acoes().entrySet()) {
                Map<String, Provento> mapa = merge.computeIfAbsent(e.getKey(), k -> new LinkedHashMap<>());
                for (Provento p : e.getValue()) mapa.put(chave(p), p);
            }
            for (Map.Entry<String, List<Provento>> e : coleta.acoes().entrySet()) {
                Map<String, Provento> mapa = merge.computeIfAbsent(e.getKey(), k -> new LinkedHashMap<>());
                for (Provento p : e.getValue()) {
                    // Quando o pagamento passa de indefinido para uma data, a chave muda.
                    // Remove a versão antiga com pagamento indefinido para não duplicar.
                    boolean substituiuIndefinido = false;
                    if (!pagamentoIndefinido(p.pagamento())) {
                        substituiuIndefinido = mapa.values().removeIf(
                                a -> mesmoProvento(a, p) && pagamentoIndefinido(a.pagamento()));
                    }

                    Provento anterior = mapa.put(chave(p), p);
                    if (anterior == null) {
                        if (substituiuIndefinido) atualizados++;
                        else novos++;
                    } else if (!anterior.equals(p)) {
                        atualizados++;
                    }
                }
            }

            acoes = new TreeMap<>();
            for (Map.Entry<String, Map<String, Provento>> e : merge.entrySet()) {
                List<Provento> lista = new ArrayList<>(e.getValue().values());
                lista.sort(Comparator.comparing(
                        (Provento p) -> dataOuMinima(p.pagamento(), cfg.formatoData()))
                        .thenComparing(p -> dataOuMinima(p.data_com(), cfg.formatoData()))
                        .thenComparing(p -> nz(p.tipo()))
                        .reversed());
                acoes.put(e.getKey(), lista);
            }

            status = "ok";
            atualizadoEm = agora;
            System.out.printf("Coleta ok: %d linhas lidas, %d rejeitadas, %d novos, %d atualizados.%n",
                    coleta.linhasLidas(), coleta.rejeitadas(), novos, atualizados);
        } catch (Exception e) {
            System.err.println("Erro na coleta: " + e.getMessage());
            acoes = cache.acoes();
            status = "erro";
            atualizadoEm = cache.atualizadoEm();
            erro = e.getMessage() + (acoes.isEmpty() ? " - sem cache anterior" : " - mantido cache anterior");
        }

        // 3. Cache existente ilegível + coleta falha: não sobrescreve nada
        if (status.equals("erro") && !cache.legivel()) {
            System.err.println("Cache existente ilegível e coleta falhou: arquivo não foi alterado.");
            System.exit(1);
        }

        // 4. Monta o JSON e grava de forma atômica
        int totalProventos = acoes.values().stream().mapToInt(List::size).sum();

        Map<String, Object> resultado = new LinkedHashMap<>();
        resultado.put("status", status);
        resultado.put("ultima_execucao", agora);
        resultado.put("atualizado_em", atualizadoEm);
        resultado.put("total_ativos", acoes.size());
        resultado.put("total_proventos", totalProventos);
        resultado.put("novos_registros", novos);
        resultado.put("registros_atualizados", atualizados);
        resultado.put("erro", erro);
        resultado.put("acoes", acoes);

        Files.writeString(cfg.arquivoTmp(), gson.toJson(resultado), StandardCharsets.UTF_8);
        moverAtomico(cfg.arquivoTmp(), cfg.arquivoJson());

        System.out.println("Finalizado com status: " + status + " (" + acoes.size() + " ativos, "
                + totalProventos + " proventos)");

        if (status.equals("erro") && cfg.falharNoErro()) {
            System.exit(1);
        }
    }

    // Um provento é identificado por tipo + data de registro + data de pagamento.
    private static String chave(Provento p) {
        return nz(p.tipo()) + "|" + nz(p.data_com()) + "|" + nz(p.pagamento());
    }

    private static boolean mesmoProvento(Provento a, Provento b) {
        return nz(a.tipo()).equals(nz(b.tipo())) && nz(a.data_com()).equals(nz(b.data_com()));
    }

    private static String nz(String s) {
        return s == null ? "" : s.trim();
    }

    // ---------- Configuração ----------
    private static Config carregarConfig(Path arquivo) throws IOException {
        Properties p = new Properties();
        if (Files.exists(arquivo)) {
            try (Reader reader = Files.newBufferedReader(arquivo, StandardCharsets.UTF_8)) {
                p.load(reader);
            }
            System.out.println("Configuração lida de " + arquivo);
        } else {
            System.out.println("Aviso: " + arquivo + " não encontrado, usando valores padrão.");
        }

        Path saida = Path.of(texto(p, "arquivo_saida", "dividendos.json"));
        Path tmp = saida.resolveSibling(saida.getFileName() + ".tmp");

        int tentativas = inteiro(p, "tentativas", 3);
        int timeout = inteiro(p, "timeout_ms", 15000);
        double maxRejeitadas = decimal(p, "max_percentual_rejeitadas", 0.20);
        if (tentativas < 1) throw new IllegalArgumentException("tentativas deve ser >= 1");
        if (timeout < 0) throw new IllegalArgumentException("timeout_ms deve ser >= 0");
        if (maxRejeitadas < 0 || maxRejeitadas > 1) {
            throw new IllegalArgumentException("max_percentual_rejeitadas deve estar entre 0 e 1");
        }

        DateTimeFormatter formato;
        try {
            formato = DateTimeFormatter.ofPattern(texto(p, "formato_data", "dd/MM/uuuu"))
                    .withResolverStyle(ResolverStyle.STRICT);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("formato_data inválido: " + e.getMessage());
        }

        return new Config(
                texto(p, "url", "https://www.dadosdemercado.com.br/agenda-de-dividendos"),
                saida,
                tmp,
                texto(p, "user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"),
                timeout,
                tentativas,
                maxRejeitadas,
                booleano(p, "falhar_no_erro", true),
                lista(p, "coluna.codigo", "codigo"),
                lista(p, "coluna.tipo", "tipo"),
                lista(p, "coluna.valor", "valor"),
                lista(p, "coluna.registro", "registro"),
                lista(p, "coluna.ex", "ex"),
                lista(p, "coluna.pagamento", "pagamento"),
                regex(p, "regex_ticker", "^[A-Z0-9]{4}\\d{1,2}$"),
                regex(p, "regex_valor", "^\\d{1,3}(\\.\\d{3})*,\\d+$"),
                formato);
    }

    private static String texto(Properties p, String chave, String padrao) {
        String v = p.getProperty(chave);
        return (v == null || v.isBlank()) ? padrao : v.trim();
    }

    private static int inteiro(Properties p, String chave, int padrao) {
        try {
            return Integer.parseInt(texto(p, chave, String.valueOf(padrao)));
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(chave + " deve ser um número inteiro");
        }
    }

    private static double decimal(Properties p, String chave, double padrao) {
        try {
            return Double.parseDouble(texto(p, chave, String.valueOf(padrao)));
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(chave + " deve ser um número (use ponto decimal)");
        }
    }

    private static boolean booleano(Properties p, String chave, boolean padrao) {
        String v = texto(p, chave, String.valueOf(padrao)).toLowerCase(Locale.ROOT);
        if (v.equals("true")) return true;
        if (v.equals("false")) return false;
        throw new IllegalArgumentException(chave + " deve ser true ou false");
    }

    private static List<String> lista(Properties p, String chave, String padrao) {
        List<String> itens = new ArrayList<>();
        for (String s : texto(p, chave, padrao).split(",")) {
            String n = normalizar(s);
            if (!n.isEmpty()) itens.add(n);
        }
        if (itens.isEmpty()) throw new IllegalArgumentException(chave + " não pode ser vazio");
        return itens;
    }

    private static Pattern regex(Properties p, String chave, String padrao) {
        try {
            return Pattern.compile(texto(p, chave, padrao));
        } catch (Exception e) {
            throw new IllegalArgumentException(chave + " não é um regex válido: " + e.getMessage());
        }
    }

    // ---------- Cache ----------
    private static Cache carregarCache(Gson gson, Config cfg) {
        Map<String, List<Provento>> acoes = new LinkedHashMap<>();
        String atualizadoEm = null;

        if (!Files.exists(cfg.arquivoJson())) {
            return new Cache(null, acoes, true);
        }

        try (Reader reader = Files.newBufferedReader(cfg.arquivoJson(), StandardCharsets.UTF_8)) {
            JsonObject json = JsonParser.parseReader(reader).getAsJsonObject();

            if (json.has("atualizado_em") && !json.get("atualizado_em").isJsonNull()) {
                atualizadoEm = json.get("atualizado_em").getAsString();
            }

            if (json.has("acoes") && json.get("acoes").isJsonObject()) {
                Type tipoLista = new TypeToken<List<Provento>>() {}.getType();
                for (Map.Entry<String, JsonElement> e : json.getAsJsonObject("acoes").entrySet()) {
                    List<Provento> lista = gson.fromJson(e.getValue(), tipoLista);
                    if (lista != null) acoes.put(e.getKey(), lista);
                }
            }
            return new Cache(atualizadoEm, acoes, true);
        } catch (Exception e) {
            System.err.println("Aviso: não foi possível ler o cache anterior: " + e.getMessage());
            return new Cache(null, new LinkedHashMap<>(), false);
        }
    }

    private static void moverAtomico(Path origem, Path destino) throws IOException {
        try {
            Files.move(origem, destino, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(origem, destino, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    // ---------- Coleta ----------
    private static Coleta coletarComTentativas(Config cfg) throws Exception {
        Exception ultimo = null;
        for (int i = 1; i <= cfg.tentativas(); i++) {
            try {
                System.out.println("Buscando " + cfg.url() + " (tentativa " + i + "/" + cfg.tentativas() + ")...");
                return coletar(cfg);
            } catch (Exception e) {
                ultimo = e;
                System.err.println("Tentativa " + i + " falhou: " + e.getMessage());
                if (i < cfg.tentativas()) Thread.sleep(2000L * i);
            }
        }
        throw ultimo;
    }

    private static Coleta coletar(Config cfg) throws Exception {
        Document doc = Jsoup.connect(cfg.url())
                .userAgent(cfg.userAgent())
                .timeout(cfg.timeoutMs())
                .maxBodySize(0) // sem truncar o HTML em 2 MB
                .get();

        List<String> cabecalhosVistos = new ArrayList<>();

        for (Element tabela : doc.select("table")) {
            Elements linhas = tabela.select("tr");
            if (linhas.isEmpty()) continue;

            List<String> cab = new ArrayList<>();
            for (Element c : linhas.get(0).select("th, td")) cab.add(normalizar(c.text()));
            cabecalhosVistos.add(cab.toString());

            Set<Integer> usados = new LinkedHashSet<>();
            int iCodigo = achar(cab, usados, cfg.colCodigo());
            int iTipo = achar(cab, usados, cfg.colTipo());
            int iValor = achar(cab, usados, cfg.colValor());
            int iRegistro = achar(cab, usados, cfg.colRegistro());
            int iEx = achar(cab, usados, cfg.colEx());
            int iPagamento = achar(cab, usados, cfg.colPagamento());

            if (iCodigo < 0 || iTipo < 0 || iValor < 0 || iRegistro < 0 || iEx < 0 || iPagamento < 0) continue;

            return lerLinhas(cfg, linhas, iCodigo, iTipo, iValor, iRegistro, iEx, iPagamento);
        }

        throw new RuntimeException("Nenhuma tabela com as colunas esperadas. Cabeçalhos encontrados: "
                + cabecalhosVistos);
    }

    private static Coleta lerLinhas(Config cfg, Elements linhas, int iCodigo, int iTipo, int iValor,
                                    int iRegistro, int iEx, int iPagamento) {
        int maior = Math.max(Math.max(Math.max(iCodigo, iTipo), Math.max(iValor, iRegistro)),
                Math.max(iEx, iPagamento));
        Map<String, List<Provento>> acoes = new LinkedHashMap<>();
        int lidas = 0;
        int rejeitadas = 0;
        int validas = 0;

        for (int i = 1; i < linhas.size(); i++) {
            Element linha = linhas.get(i);
            if (linha.select("td").isEmpty()) continue; // linha sem dados (ex.: só cabeçalho)
            Elements cols = linha.children(); // células diretas da linha (td ou th)
            lidas++;

            if (cols.size() <= maior) { rejeitadas++; continue; }

            String ticker = limpar(cols.get(iCodigo).text()).toUpperCase(Locale.ROOT);
            String tipo = limpar(cols.get(iTipo).text());
            String valor = limpar(cols.get(iValor).text());
            String registro = limpar(cols.get(iRegistro).text());
            String ex = limpar(cols.get(iEx).text());
            String pagamento = limpar(cols.get(iPagamento).text());

            if (!cfg.regexTicker().matcher(ticker).matches()
                    || tipo.isEmpty()
                    || !cfg.regexValor().matcher(valor).matches()
                    || !dataValida(registro, cfg.formatoData())
                    || !dataValida(ex, cfg.formatoData())
                    || !pagamentoValido(pagamento, cfg.formatoData())) {
                rejeitadas++;
                continue;
            }

            acoes.computeIfAbsent(ticker, k -> new ArrayList<>())
                    .add(new Provento(tipo, valor, registro, ex, pagamento));
            validas++;
        }

        if (lidas == 0 || validas == 0) {
            throw new RuntimeException("Nenhuma linha válida na tabela (linhas lidas: " + lidas + ")");
        }
        if ((double) rejeitadas / lidas > cfg.maxPercentualRejeitadas()) {
            throw new RuntimeException("Layout possivelmente alterado: " + rejeitadas + " de " + lidas
                    + " linhas rejeitadas pela validação");
        }

        return new Coleta(acoes, lidas, rejeitadas);
    }

    // ---------- Utilidades ----------
    // Troca espaço não separável (nbsp) por espaço comum e remove espaços nas pontas
    private static String limpar(String s) {
        return s == null ? "" : s.replace('\u00a0', ' ').strip();
    }

    private static boolean pagamentoIndefinido(String s) {
        return PAGAMENTO_INDEFINIDO.contains(normalizar(limpar(s)));
    }

    // Pagamento é válido se for uma data no formato configurado ou um valor de "ainda não definido"
    private static boolean pagamentoValido(String s, DateTimeFormatter formato) {
        return pagamentoIndefinido(s) || dataValida(limpar(s), formato);
    }

    private static boolean dataValida(String texto, DateTimeFormatter formato) {
        try {
            LocalDate.parse(texto, formato);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    // Retorna LocalDate.MIN quando não for uma data (ex.: pagamento indefinido)
    private static LocalDate dataOuMinima(String texto, DateTimeFormatter formato) {
        try {
            return LocalDate.parse(texto, formato);
        } catch (Exception e) {
            return LocalDate.MIN;
        }
    }

    private static int achar(List<String> cabecalho, Set<Integer> usados, List<String> aliases) {
        for (int i = 0; i < cabecalho.size(); i++) {
            if (usados.contains(i)) continue;
            for (String alias : aliases) {
                if (cabecalho.get(i).startsWith(alias)) {
                    usados.add(i);
                    return i;
                }
            }
        }
        return -1;
    }

    private static String normalizar(String s) {
        String semAcento = Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}", "");
        return semAcento.toLowerCase(Locale.ROOT).trim();
    }
}
