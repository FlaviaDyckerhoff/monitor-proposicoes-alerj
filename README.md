# 🏛️ Monitor Proposições — ALERJ (RJ)

Monitora automaticamente o portal da Assembleia Legislativa do Estado do Rio de Janeiro e envia email quando há proposições novas. Roda **4x por dia** via GitHub Actions (8h, 12h, 17h e 21h, horário de Brasília).

---

## Tipos monitorados

| Sigla | Descrição | ID portal |
|-------|-----------|-----------|
| PEC | Proj. Emenda Constitucional | 158 |
| PLC | Proj. de Lei Complementar | 160 |
| PL | Proj. de Lei | 161 |
| PDL | Proj. Decreto Legislativo | 162 |
| PR | Proj. de Resolução | 163 |
| IND-L | Indicação Legislativa | 164 |
| IND | Indicação | 165 |
| MOC | Moção | 167 |
| REQ | Requerimento | 170 |
| REQ-I | Req. de Informação | 171 |
| REQ-SN | Req. sem Número | 172 |

---

## Como funciona

A ALERJ usa **IBM Lotus Notes/Domino** — não há API REST. O script faz scraping de HTML server-rendered (sem JavaScript, sem Playwright), leve e confiável.

1. GitHub Actions roda o script 4x/dia
2. Para cada tipo, faz GET na URL `www3.alerj.rj.gov.br/lotus_notes/default.asp?id=XXX`
3. Extrai proposições da tabela HTML (código 11 dígitos, ementa, data, autor)
4. Compara com `estado.json` para identificar novidades
5. Se houver novas → envia email agrupado por tipo
6. Salva estado atualizado no repositório

**Identificador único:** `SIGLA-CODIGODOMINONO` (ex: `PL-20260307407`)
**Número exibido:** derivado do código — `20260307407` → `407/2026`

---

## Estrutura do repositório

```
monitor-proposicoes-rj/
├── monitor.js
├── package.json
├── estado.json
├── README.md
└── .github/workflows/monitor.yml
```

---

## Setup

### 1. Gmail — App Password
- Acesse myaccount.google.com/security
- Ative verificação em duas etapas
- Crie senha de app com nome `monitor-alerj` → copie os 16 caracteres

### 2. Repositório GitHub
- Novo repositório privado: `monitor-proposicoes-rj`
- Upload: `monitor.js`, `package.json`, `README.md`
- Criar manualmente: `.github/workflows/monitor.yml`

### 3. Secrets
Settings → Secrets and variables → Actions → New repository secret:

| Name | Valor |
|------|-------|
| `EMAIL_REMETENTE` | seu Gmail |
| `EMAIL_SENHA` | senha de 16 letras (sem espaços) |
| `EMAIL_DESTINO` | email de destino |

### 4. Primeiro teste
Actions → Monitor Proposições ALERJ → Run workflow

Aguarde ~60 segundos (11 requests com pausa de 1,5s entre eles).

---

## Resetar o estado

Edite `estado.json` no repositório e substitua por:
```json
{"proposicoes_vistas":[],"ultima_execucao":""}
```

---

## Problemas comuns

**0 proposições em todos os tipos** → Portal fora do ar. Teste: `http://www3.alerj.rj.gov.br/lotus_notes/default.asp?id=161`

**Authentication failed** → `EMAIL_SENHA` colado com espaços.

**Workflow não aparece** → Arquivo precisa estar em `.github/workflows/monitor.yml`
