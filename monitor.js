const fs = require('fs');
const nodemailer = require('nodemailer');

const EMAIL_DESTINO = process.env.EMAIL_DESTINO;
const EMAIL_REMETENTE = process.env.EMAIL_REMETENTE;
const EMAIL_SENHA = process.env.EMAIL_SENHA;
const ARQUIVO_ESTADO = 'estado.json';
const BASE_URL = 'http://www3.alerj.rj.gov.br/lotus_notes/default.asp';

const TIPOS = [
  { sigla: 'PEC',    label: 'Proj. Emenda Constitucional', id: 158 },
  { sigla: 'PLC',    label: 'Proj. de Lei Complementar',   id: 160 },
  { sigla: 'PL',     label: 'Proj. de Lei',                id: 161 },
  { sigla: 'PDL',    label: 'Proj. Decreto Legislativo',   id: 162 },
  { sigla: 'PR',     label: 'Proj. de Resolução',          id: 163 },
  { sigla: 'IND-L',  label: 'Indicação Legislativa',       id: 164 },
  { sigla: 'IND',    label: 'Indicação',                   id: 165 },
  { sigla: 'MOC',    label: 'Moção',                       id: 167 },
  { sigla: 'REQ',    label: 'Requerimento',                id: 170 },
  { sigla: 'REQ-I',  label: 'Req. de Informação',          id: 171 },
  { sigla: 'REQ-SN', label: 'Req. sem Número',             id: 172 },
];

// ─── Estado ───────────────────────────────────────────────────────────────────

function carregarEstado() {
  if (fs.existsSync(ARQUIVO_ESTADO)) {
    return JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf8'));
  }
  return { proposicoes_vistas: [], ultima_execucao: '' };
}

function salvarEstado(estado) {
  fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado, null, 2));
}

// ─── Scraping ─────────────────────────────────────────────────────────────────

function limparHtml(str) {
  return str
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function extrairProposicoesDaPagina(html, tipo) {
  const proposicoes = [];

  // Estrutura real do Domino (confirmada inspecionando o HTML):
  //
  // <tr>
  //   <td>[20260307407](#)</td>           ← código 11 dígitos (col 0)
  //   <td>Blue right arrow Icon</td>      ← ícone (col 1)
  //   <td>EMENTA =>20260307407=> {...}</td>  ← descrição (col 2)
  //   <td>06/04/2026</td>                 ← data (col 3)
  //   <td>AUTOR</td>                      ← autor (col 4)
  // </tr>
  //
  // A ementa é o texto da col 2 ANTES do primeiro " =>"

  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;

  while ((trMatch = trRegex.exec(html)) !== null) {
    const linha = trMatch[1];

    // Filtra apenas linhas com código de 11 dígitos
    const codigoMatch = linha.match(/\b(\d{11})\b/);
    if (!codigoMatch) continue;

    const codigo = codigoMatch[1];
    const ano = codigo.substring(0, 4);
    const numero = String(parseInt(codigo.substring(6), 10));

    // Extrai todas as células como texto limpo
    const tds = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch;
    while ((tdMatch = tdRegex.exec(linha)) !== null) {
      tds.push(limparHtml(tdMatch[1]));
    }

    if (tds.length < 3) continue;

    // Localiza a célula de descrição: é a que contém " =>" (separador Domino)
    // e também contém o código. Normalmente é tds[2], mas buscamos para robustez.
    let ementa = '-';
    let data = '-';
    let autor = '-';

    for (let i = 0; i < tds.length; i++) {
      if (tds[i].includes('=>') && tds[i].includes(codigo)) {
        // Ementa = tudo antes do primeiro "=>"
        const partes = tds[i].split('=>');
        ementa = partes[0].trim().substring(0, 300);

        // Data: próxima célula com formato DD/MM/AAAA
        for (let j = i + 1; j < tds.length; j++) {
          const dataMatch = tds[j].match(/\d{2}\/\d{2}\/\d{4}/);
          if (dataMatch) {
            data = dataMatch[0];
            if (tds[j + 1] && tds[j + 1].trim()) {
              autor = tds[j + 1].substring(0, 200);
            }
            break;
          }
        }
        break;
      }
    }

    proposicoes.push({
      id: `${tipo.sigla}-${codigo}`,
      codigo,
      sigla: tipo.sigla,
      label: tipo.label,
      numero,
      ano,
      autor,
      data,
      ementa,
    });
  }

  return proposicoes;
}

async function buscarTipo(tipo) {
  const url = `${BASE_URL}?id=${tipo.id}`;
  console.log(`  🔍 ${tipo.sigla} (id=${tipo.id})`);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; monitor-alerj/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.error(`  ❌ HTTP ${response.status} para ${tipo.sigla}`);
      return [];
    }

    const html = await response.text();
    const lista = extrairProposicoesDaPagina(html, tipo);
    console.log(`  ✅ ${tipo.sigla}: ${lista.length} proposições encontradas`);

    // Debug: mostra primeira proposição para validar campos
    if (lista.length > 0) {
      const p = lista[0];
      console.log(`     Exemplo: ${p.numero}/${p.ano} | ${p.data} | ${p.autor.substring(0,30)} | ${p.ementa.substring(0,60)}...`);
    }

    return lista;
  } catch (err) {
    console.error(`  ❌ Erro ao buscar ${tipo.sigla}: ${err.message}`);
    return [];
  }
}

async function buscarTodasProposicoes() {
  const todas = [];
  for (const tipo of TIPOS) {
    const lista = await buscarTipo(tipo);
    todas.push(...lista);
    await new Promise(r => setTimeout(r, 1500));
  }
  return todas;
}

// ─── Email ────────────────────────────────────────────────────────────────────

async function enviarEmail(novas) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_REMETENTE, pass: EMAIL_SENHA },
  });

  const porTipo = {};
  novas.forEach(p => {
    if (!porTipo[p.label]) porTipo[p.label] = [];
    porTipo[p.label].push(p);
  });

  const ordemTipos = TIPOS.map(t => t.label);
  const tiposOrdenados = Object.keys(porTipo)
    .sort((a, b) => ordemTipos.indexOf(a) - ordemTipos.indexOf(b));

  const linhas = tiposOrdenados.map(label => {
    const grupo = porTipo[label];
    grupo.sort((a, b) => (parseInt(b.numero) || 0) - (parseInt(a.numero) || 0));

    const header = `
      <tr>
        <td colspan="5" style="padding:10px 8px 4px;background:#e8eef5;font-weight:bold;
          color:#1a3a5c;font-size:13px;border-top:3px solid #1a3a5c">
          ${label} — ${grupo.length} nova(s)
        </td>
      </tr>`;

    const rows = grupo.map(p => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee;color:#555;font-size:12px;
          white-space:nowrap">${p.sigla}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;white-space:nowrap">
          <strong>${p.numero}/${p.ano}</strong>
        </td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${p.autor}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px;
          white-space:nowrap">${p.data}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${p.ementa}</td>
      </tr>`).join('');

    return header + rows;
  }).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:960px;margin:0 auto">
      <h2 style="color:#1a3a5c;border-bottom:2px solid #1a3a5c;padding-bottom:8px">
        🏛️ ALERJ — ${novas.length} nova(s) proposição(ões)
      </h2>
      <p style="color:#666;margin-top:0">
        Monitoramento automático — ${new Date().toLocaleString('pt-BR')}
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#1a3a5c;color:white">
            <th style="padding:10px;text-align:left">Sigla</th>
            <th style="padding:10px;text-align:left">Número/Ano</th>
            <th style="padding:10px;text-align:left">Autor(es)</th>
            <th style="padding:10px;text-align:left">Data Publ.</th>
            <th style="padding:10px;text-align:left">Ementa</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
      <p style="margin-top:20px;font-size:12px;color:#999">
        Acesse: <a href="http://www3.alerj.rj.gov.br">www3.alerj.rj.gov.br</a>
      </p>
    </div>
  `;

  await transporter.sendMail({
    from: `"Monitor ALERJ" <${EMAIL_REMETENTE}>`,
    to: EMAIL_DESTINO,
    subject: `🏛️ ALERJ: ${novas.length} nova(s) proposição(ões) — ${new Date().toLocaleDateString('pt-BR')}`,
    html,
  });

  console.log(`✅ Email enviado com ${novas.length} proposições novas.`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('🚀 Iniciando monitor ALERJ...');
  console.log(`⏰ ${new Date().toLocaleString('pt-BR')}`);

  const estado = carregarEstado();
  const idsVistos = new Set(estado.proposicoes_vistas.map(String));

  console.log(`\n📋 Buscando ${TIPOS.length} tipos de proposições...`);
  const todas = await buscarTodasProposicoes();

  if (todas.length === 0) {
    console.log('⚠️ Nenhuma proposição encontrada. Verifique o portal.');
    process.exit(0);
  }

  console.log(`\n📊 Total encontrado: ${todas.length} proposições`);

  const novas = todas.filter(p => !idsVistos.has(p.id));
  console.log(`🆕 Novas (não vistas antes): ${novas.length}`);

  if (novas.length > 0) {
    await enviarEmail(novas);
    novas.forEach(p => idsVistos.add(p.id));
  } else {
    console.log('✅ Sem novidades. Nada a enviar.');
  }

  estado.proposicoes_vistas = Array.from(idsVistos);
  estado.ultima_execucao = new Date().toISOString();
  salvarEstado(estado);
})();
