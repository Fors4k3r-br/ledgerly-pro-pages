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

    record Dividendo(
            String codigo,
            String tipo,
            String valor,
            String registro,
            String ex,
            String pagamento
    ) {}

    public static void main(String[] args) throws Exception {

        System.out.println("Baixando agenda de dividendos...");

        List<Dividendo> dividendos = buscarAgenda();

        Map<String, Object> resultado = new LinkedHashMap<>();

        resultado.put("atualizado_em", Instant.now().toString());
        resultado.put("quantidade", dividendos.size());
        resultado.put("dividendos", dividendos);

        Gson gson = new GsonBuilder()
                .setPrettyPrinting()
                .create();

        try (FileWriter writer = new FileWriter("dividendos.json")) {
            gson.toJson(resultado, writer);
        }

        System.out.println(
                "Arquivo dividendos.json criado com "
                        + dividendos.size()
                        + " registros."
        );
    }

    private static List<Dividendo> buscarAgenda() throws Exception {

        String url =
                "https://www.dadosdemercado.com.br/agenda-de-dividendos";

        Document doc = Jsoup.connect(url)
                .userAgent("Mozilla/5.0")
                .timeout(15000)
                .get();

        Element tabela = doc.selectFirst("table");

        if (tabela == null) {
            throw new RuntimeException(
                    "Tabela da agenda de dividendos não encontrada."
            );
        }

        List<Dividendo> lista = new ArrayList<>();

        Elements linhas = tabela.select("tr");

        for (int i = 1; i < linhas.size(); i++) {

            Elements cols = linhas.get(i).select("td");

            if (cols.size() < 6) {
                continue;
            }

            lista.add(
                    new Dividendo(
                            cols.get(0).text().trim(),
                            cols.get(1).text().trim(),
                            cols.get(2).text().trim(),
                            cols.get(3).text().trim(),
                            cols.get(4).text().trim(),
                            cols.get(5).text().trim()
                    )
            );
        }

        return lista;
    }
}
