require("dotenv").config({ quiet: true });

const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const PORTA = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Sem as credenciais o servidor nao tem como gravar nada: melhor parar logo
// na subida do que aceitar requisicoes e falhar em todas.
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Faltam SUPABASE_URL e/ou SUPABASE_KEY nas variaveis de ambiente (veja .env.example).");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = express();

app.use(express.json());

// Converte o valor recebido em numero. Aceita numero ou texto numerico
// simples ("89.05"). Devolve null para qualquer outra coisa.
function lerValor(valor) {
  if (typeof valor === "number") {
    return Number.isFinite(valor) ? valor : null;
  }
  if (typeof valor === "string" && /^\d+(\.\d+)?$/.test(valor.trim())) {
    return Number(valor.trim());
  }
  return null;
}

// Aceita inteiro positivo (1) ou texto com inteiro positivo ("1").
function lerId(id) {
  if (typeof id === "number" && Number.isInteger(id) && id > 0) return id;
  if (typeof id === "string" && /^[1-9]\d*$/.test(id.trim())) return Number(id.trim());
  return null;
}

// Aceita um UUID no formato 8-4-4-4-12 (ex.: "2230afaf-5456-4046-b1b5-823a5ae62428").
// Devolve em minusculas para gravar sempre do mesmo jeito.
function lerUuid(id) {
  if (typeof id !== "string") return null;
  const limpo = id.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(limpo) ? limpo : null;
}

// Aceita somente "AAAA-MM-DD" que seja uma data de verdade (recusa 2025-02-30).
function lerData(data) {
  if (typeof data !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
  const d = new Date(`${data}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === data ? data : null;
}

const TIPOS = ["entrada", "saida"];

app.get("/health", (req, res) => {
  res.status(200).json({ servico: "financas-claudia", versao: "1.1.0" });
});

app.post("/lancamentos", async (req, res) => {
  const corpo = req.body || {};

  const valor = lerValor(corpo.valor);
  if (valor === null || valor <= 0) {
    return res.status(400).json({ erro: "valor_invalido" });
  }

  const user_id = lerUuid(corpo.user_id);
  if (user_id === null) return res.status(400).json({ erro: "user_id_invalido" });

  const conta_id = lerId(corpo.conta_id);
  if (conta_id === null) return res.status(400).json({ erro: "conta_id_invalido" });

  const categoria_id = lerId(corpo.categoria_id);
  if (categoria_id === null) return res.status(400).json({ erro: "categoria_id_invalido" });

  if (!TIPOS.includes(corpo.tipo)) {
    return res.status(400).json({ erro: "tipo_invalido" });
  }

  const data_lancamento = lerData(corpo.data_lancamento);
  if (data_lancamento === null) {
    return res.status(400).json({ erro: "data_lancamento_invalida" });
  }

  if (corpo.descricao != null && typeof corpo.descricao !== "string") {
    return res.status(400).json({ erro: "descricao_invalida" });
  }

  // Monta a linha campo a campo: nada alem destas colunas chega ao banco,
  // entao o cliente nao consegue mandar, por exemplo, um lancamento_id proprio.
  const linha = {
    user_id,
    conta_id,
    categoria_id,
    tipo: corpo.tipo,
    valor,
    data_lancamento,
    descricao: corpo.descricao ?? null,
  };

  try {
    const { data, error } = await supabase
      .from("lancamentos")
      .insert(linha)
      .select("lancamento_id")
      .single();

    if (error) {
      console.error("Supabase recusou o insert:", error);
      return res.status(500).json({ erro: "falha_ao_gravar" });
    }

    return res.status(201).json({ lancamento_id: data.lancamento_id });
  } catch (err) {
    // Falha de rede ou outra excecao inesperada ao falar com o Supabase.
    console.error("Erro ao falar com o Supabase:", err);
    return res.status(500).json({ erro: "falha_ao_gravar" });
  }
});

// JSON malformado no corpo: responde 400 em JSON em vez da pagina HTML padrao.
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ erro: "json_invalido" });
  }
  console.error(err);
  res.status(500).json({ erro: "erro_interno" });
});

app.listen(PORTA, () => {
  console.log(`financas-claudia rodando na porta ${PORTA}`);
});
