import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;

import java.io.FileWriter;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class Scraper {

    record Provento(String tipo, String valor, String data_com, String pagamento) {}

    private static final List<String> TICKERS = List.of("PETR4", "VALE3", "ITUB4", "BBAS3", "WEGE3");

    public static void main(String[] args) throws Exception {
        Map<String, Object> resultado = new LinkedHashMap<>();
        resultado.put("atualizado_em", Instant.now().toString());

        Map<String, List<Provento>> acoes = new LinkedHashMap<>();

        for (String ticker : TICKERS) {
            try {
                System.out.println("Buscando " + ticker + "...");
                acoes.put(ticker, buscarProventos(ticker));
            } catch (Exception e) {
                System.err.println("Erro em " + ticker + ": " + e.getMessage());
                acoes.put(ticker, List.of());
            }
            Thread.sleep(2000);
        }

        resultado.put("acoes", acoes);

        Gson gson = new GsonBuilder().setPrettyPrinting().create();
        try (FileWriter writer = new FileWriter("dividendos.json")) {
            gson.toJson(resultado, writer);
        }

        System.out.println("Arquivo dividendos.json atualizado com sucesso!");
    }

    private static List<Provento> buscarProventos(String ticker) throws Exception {
        String url = "https://www.dadosdemercado.com.br/acoes/" + ticker + "/dividendos";
        Document doc = Jsoup.connect(url)
                .userAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                .timeout(10000)
                .get();

        List<Provento> proventos = new ArrayList<>();
        Element tabela = doc.selectFirst("table");
        if (tabela == null) return proventos;

        Elements linhas = tabela.select("tr");
        int limite = Math.min(linhas.size(), 21);
        for (int i = 1; i < limite; i++) {
            Elements cols = linhas.get(i).select("td");
            if (cols.size() >= 4) {
                proventos.add(new Provento(
                    cols.get(0).text().trim(),
                    cols.get(1).text().trim(),
                    cols.get(2).text().trim(),
                    cols.get(3).text().trim()
                ));
            }
        }
        return proventos;
    }
}
