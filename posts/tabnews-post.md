# opencode-tier-router: roteando OpenCode para o modelo certo

Plataformas como OpenCode, Cline, Cody e Continue.dev mudaram a forma como programamos: em vez de digitar comandos manualmente, pedimos a um agente para buscar arquivos, entender o projeto, editar código, rodar testes e explicar decisões. O problema é que nem toda tarefa exige o mesmo nível de raciocínio, contexto ou capacidade de modelo.

Um agente que sempre usa o mesmo modelo para tudo acaba enfrentando três custos invisíveis:

1. **Desperdício de tokens**: buscar um arquivo, listar diretórios ou ler uma implementação pequena podem consumir contexto de um modelo caro.
2. **Poluição de contexto**: a sessão principal acumula chamadas de `read`, `grep`, `bash`, `edit` e resultados intermediários.
3. **Latência desnecessária**: tarefas simples ou de baixo risco podem ser resolvidas mais rápido com um modelo pequeno, enquanto tarefas complexas precisam de mais capacidade.

O plugin **opencode-tier-router** para OpenCode tenta resolver exatamente esse problema: ele introduz um roteador de tarefas em tiers, usando `@fast`, `@medium` e `@heavy` para direcionar cada solicitação para o modelo mais adequado.

## O que é um LLM Router

Um LLM Router é um sistema que decide qual modelo usar para cada tarefa. Em vez de mandar todo pedido para o modelo mais forte, o router avalia complexidade, especialização, custo, latência e contexto disponível.

O paper **[Agent-as-a-Router: Agentic Model Routing for Coding Tasks](https://arxiv.org/abs/2606.22902)** argumenta que, na prática, usuários têm acesso a múltiplos modelos, mas nenhum domina todos os domínios. Portanto, rotear cada tarefa para o modelo mais adequado é crítico para custo e performance. O paper também aponta que roteadores estáticos sofrem com **information deficit**: eles não aprendem com a execução real das tarefas. Como solução, ele propõe um loop C-A-F, de `Context -> Action -> Feedback -> Context`, para fechar essa lacuna com feedback baseado em execução.

O artigo **[Como o LLM Router Pode Reduzir Custos de Tokens](https://medium.com/@gustavo_tavares99/como-o-llm-router-pode-reduzir-custos-de-tokens-t%C3%A9cnicas-b%C3%A1sicas-a-avan%C3%A7adas-com-langchain-e-3d37e617fbbf)**, do Gustavo Tavares, apresenta a ideia de forma prática: começar com roteamento por regra, evoluir para embeddings, classificadores e grafos dinâmicos, usando modelos menores quando possível e modelos maiores apenas quando necessário.

O opencode-tier-router aplica essa ideia no contexto de agentes de programação: em vez de rotear chamadas HTTP para modelos, ele roteia **tarefas de desenvolvimento** entre tiers de subagentes do OpenCode.

## A ideia do plugin

O plugin é um plugin do OpenCode, não um agente autônomo e não um proxy externo. Ele usa hooks do runtime para observar mensagens, transformar prompts de sistema, controlar permissões e interceptar execução de ferramentas.

A arquitetura central é simples:

- `@fast` para busca, leitura, listagem, exploração e perguntas simples.
- `@medium` para implementação, refatoração, correções, build e mudanças de código.
- `@heavy` para arquitetura, design, debugging complexo, análise, revisão, regras e especificações.

Cada tier pode apontar para um modelo diferente em `tiers.json`. O plugin também usa um `costRatio` relativo para deixar explícito que `@fast` deve ser mais barato, `@medium` intermediário e `@heavy` o mais caro.

Exemplo de configuração:

```json
{
  "mode": "normal",
  "tiers": {
    "fast": {
      "model": "opencode/big-pickle",
      "costRatio": 1,
      "cap": 8,
      "thresholds": { "min": 0, "max": 2000 }
    },
    "medium": {
      "model": "llama.cpp/Nex-N2-mini",
      "costRatio": 5,
      "cap": 12,
      "thresholds": { "min": 2000, "max": 10000 }
    },
    "heavy": {
      "model": "llama.cpp/Nex-N2-mini",
      "costRatio": 20,
      "cap": 20,
      "thresholds": { "min": 10000, "max": null }
    }
  },
  "modes": {
    "normal": { "description": "Balanced routing", "defaultTier": "medium" },
    "budget": { "description": "Cost-first", "defaultTier": "fast" },
    "quality": { "description": "Quality-first", "defaultTier": "medium" },
    "deep": { "description": "Depth-first", "defaultTier": "heavy" }
  },
  "taskPatterns": {
    "fast": ["find", "grep", "search", "read", "list", "explore", "buscar", "procurar", "ler", "onde", "arquivo"],
    "medium": ["refactor", "implement", "fix", "build", "create", "edit", "refatorar", "corrigir", "criar", "editar"],
    "heavy": ["design", "architecture", "debug", "analyze", "review", "arquitetura", "depurar", "analisar", "revisar"]
  },
  "enforcement": {
    "mode": "hard-block",
    "trivialDirectAllowed": false
  },
  "routing": {
    "strategy": "llm",
    "selectorModel": "opencode/big-pickle",
    "selectorTimeoutMs": 1200,
    "selectorMaxTokens": 16
  }
}
```

Na prática, o arquivo `tiers.json` é o ponto de configuração principal. A resolução segue esta ordem:

1. `./tiers.json` no projeto atual.
2. `~/.config/opencode/tiers.json` global.
3. Defaults internos do plugin.

## Como a classificação acontece

O fluxo começa no hook `chat.message`. Quando o usuário envia uma mensagem, o plugin extrai o texto da solicitação e chama `selectTierByStrategy`.

A estratégia de seleção tem fallback explícito:

```text
llm -> keyword/lexicon -> defaultTier
```

Quando `routing.strategy` é `llm`, o plugin chama `session.prompt()` com um prompt curto pedindo exatamente `fast`, `medium` ou `heavy`. Se o selector falhar ou timeout, o plugin cai para classificação por keyword/lexicon e, se ainda não houver correspondência, usa o `defaultTier` do modo ativo.

Quando `routing.strategy` é `keyword`, o plugin usa os padrões de `taskPatterns` e depois um lexicon adicional. A ordem de precedência favorece termos mais complexos: `heavy` tem prioridade sobre `medium`, que tem prioridade sobre `fast`.

Exemplo:

```text
"busque onde existe autenticação no frontend"
```

Tende a `@fast`: é uma tarefa de busca/leitura.

```text
"refatore a função de login"
```

Tende a `@medium`: envolve mudança de código.

```text
"analise a arquitetura da API e proponha uma migração de qualidade"
```

Tende a `@heavy`: envolve arquitetura, análise e decisão de qualidade.

## O protocolo de delegação

Quando o plugin não está em modo hard-block, ele injeta um bloco informativo no system prompt via `experimental.chat.system.transform`. Esse bloco é construído por `buildDelegationProtocol` e resume:

- tiers disponíveis;
- modelos associados;
- custo relativo;
- modo ativo;
- estratégias de roteamento;
- regras de delegação;
- comportamento esperado dos subagentes.

Esse protocolo é pequeno, cerca de 210 tokens, e serve para lembrar o modelo principal qual é a arquitetura esperada. Ele não é o único mecanismo de enforcement, mas ajuda a reduzir ambiguidade.

Exemplo do formato do protocolo:

```markdown
--- Task Delegation Reference ---
Tiers: @fast=model(1x) @medium=model(5x) @heavy=model(20x) mode:normal
Default: @medium
Cost signal: @fast≈1x, @medium≈5x, @heavy≈20x
Rule: Delegate via task when the request matches a tier's patterns.
Rule: Subagents execute the work and return results.
---
```

## Hard-block: a janela principal vira roteador

O ponto mais importante do plugin é o enforcement hard-block.

Quando `enforcement.mode` é `hard-block`, o plugin trata a sessão principal como um roteador. Isso significa que a janela principal deve classificar e delegar, não executar a tarefa diretamente.

A configuração segura é:

```json
{
  "enforcement": {
    "mode": "hard-block",
    "trivialDirectAllowed": false
  }
}
```

Com isso, mesmo uma tarefa simples de busca é delegada para `@fast`. A intenção é manter a janela principal limpa e impedir que ela acumule ferramentas e resultados intermediários.

O enforcement não depende apenas de texto. Ele combina três camadas:

1. **Prompt injection**: o system prompt recebe uma mensagem forte dizendo que o agente é roteador, não executor.
2. **`permission.ask`**: nega permissões nativas na sessão principal hard-blockada e permite subagentes.
3. **`event`**: rejeita eventos de permissão para sessões bloqueadas.
4. **`tool.execute.before`**: intercepta ferramentas como `bash`, `read`, `grep`, `edit` e `write`, redirecionando argumentos para mostrar uma mensagem de delegação ao modelo.

Essa última parte existe porque, em alguns runtimes, `allow: false` e `message` em `tool.execute.before` não são suficientes. O plugin contorna isso alterando os argumentos da ferramenta para gerar uma resposta legível ao modelo, por exemplo:

```text
Delegue para @fast. Esta ferramenta esta bloqueada para execucao direta.
```

Esse comportamento é descrito em `ENFORCEMENT.md`: a garantia do plugin é que a janela principal não execute tarefas diretamente; ela sempre delega para os subagentes adequados.

## Onde os hooks aparecem

O ponto de entrada do plugin é `src/index.ts`. Ele registra os hooks principais:

```ts
{
  config,
  'chat.message',
  'experimental.chat.system.transform',
  'permission.ask',
  'tool.execute.before',
  event,
  'tool.definition',
  'tool.execute.after',
  'experimental.text.complete',
  'command.execute.before'
}
```

O `config` hook carrega a configuração e registra os agents/tiers no runtime. O `chat.message` hook classifica a solicitação. O `experimental.chat.system.transform` hook injeta o protocolo ou a mensagem de hard-block. Os hooks de permissão e execução de ferramentas aplicam fallback de enforcement.

A ordem de execução, conforme documentado no projeto, é:

```text
config → chat.message → experimental.chat.system.transform → permission.ask
  → tool.execute.before → event → tool.definition → tool.execute.after
  → experimental.text.complete → command.execute.before
```

## Subagentes isolados

Cada tier mapeia para um tipo de subagent do OpenCode. O projeto usa este mapeamento:

```text
explore -> @fast
build   -> @medium
general -> @heavy
plan    -> @heavy
```

Os subagentes recebem contexto diferente do agente principal. Eles não recebem o protocolo de router completo; recebem diretivas próprias, como não disparar sub-sub-agents e não perguntar ao usuário sem necessidade. Isso mantém a delegação controlada: a sessão principal decide para onde mandar, e o subagent executa.


Além disso, o plugin registra permissões para subagentes em `config`, permitindo ferramentas como leitura, edição, glob, grep, lista, bash, webfetch, websearch, LSP, skills e outras. Depois, no `tool.execute.after`, ele rastreia chamadas somente leitura com `grep`, `read`, `glob` e `list`.

## Caps e redundância

O módulo `src/router/caps.ts` implementa um cap tracker. Ele conta chamadas somente leitura e gera banners quando há sinais de fadiga de leitura ou uso excessivo.

Exemplos de banners:

```text
[cap: 3/8]
[cap warning: 2 remaining]
[cap reached (8/8)]
[redundant: this is the same read you ran at call #2]
```

Esse detalhe é importante porque tarefas de busca e exploração tendem a gerar muitas leituras. Sem cap, um subagent pode repetir `read` do mesmo arquivo várias vezes, poluindo contexto e consumindo tokens.

## Economia de tokens na prática

A economia principal vem de tirar da sessão principal tarefas que exigem pouca raciocínio, mas consomem muito contexto. Ferramentas de baixo valor cognitivo, como `read`, `grep`, `find`, `list` e `glob`, são úteis para exploração, mas seus resultados tendem a trazer caminhos longos, trechos repetidos de arquivo, listagens de diretórios e diffs grandes. Em uma janela principal, esse material não aumenta muito o valor da decisão; ele apenas aumenta o custo e o risco de evicção.

Em um cenário hipotético, imagine uma sessão típica com 30 chamadas de ferramenta:

| Chamadas | Tipo de tarefa | Modelo alvo | Custo relativo |
| --- | --- | --- | --- |
| 20 | `read`, `grep`, `find`, `list`, `glob` | `@fast` | ~1x |
| 10 | `edit`, análise, debug, implementação | `@medium` ou `@heavy` | 5x a 20x |

Se cada chamada de busca consome entre 500 e 2000 tokens no trajeto ida e volta, a diferença de custo relativo fica clara. Sem router, os 30 passos passam pelo modelo pesado:

```text
30 * X tokens no modelo caro
```

Com router, 20 chamadas de baixo valor cognitivo vão para `@fast`, enquanto as 10 chamadas restantes vão para `@medium` ou `@heavy`:

```text
20 * 1x + 10 * (5x ou 20x)
```

Além do custo direto, há economia por isolamento de contexto. Outputs de busca ficam contidos nos subagentes: listagens de diretório, conteúdo de arquivos, resultados de `grep` e caminhos de arquivos não poluem a sessão principal. Em rodadas de exploração, esse histórico pode somar facilmente 5k a 15k tokens por rodada. O resultado é uma economia dupla: (a) menos tokens processados pelo modelo caro e (b) uma janela principal mais enxuta, reduzindo evicção de informações relevantes.

## Modo, fallback e custo

O plugin tem quatro modos:

- `normal`: balanceado, default `@medium`.
- `budget`: custo primeiro, default `@fast`.
- `quality`: qualidade primeiro, prefere `@medium` e `@heavy`.
- `deep`: profundidade primeiro, envia arquitetura/debug para `@heavy` e default `@heavy`.

O comando `/budget` pode alternar o modo ativo e persistir a mudança em `tiers.json`.

A lógica de custo é simples, mas útil: o plugin usa `costRatio` para tornar explícito que tarefas simples devem ir para tiers baratos e tarefas complexas para tiers caros. Isso ajuda a evitar o erro comum de usar sempre o modelo mais capaz, mesmo quando a tarefa não exige.

## Exemplo de fluxo

Imagine a seguinte solicitação:

```text
Encontre onde o frontend valida o token e me mostre os arquivos.
```

O fluxo seria:

1. `chat.message` coleta o texto.
2. `selectTierByStrategy` identifica buscas e leitura.
3. O plugin seleciona `@fast`.
4. O system prompt recebe uma dica de roteamento: delegar para `@fast`.
5. A sessão principal chama `task` com `subagent_type=fast`.
6. O subagent executa busca/leitura.
7. Resultados retornam para a sessão principal.

Agora imagine:

```text
Analise a arquitetura da API e proponha uma migração para reduzir acoplamento.
```

O fluxo muda:

1. O texto contém sinais de análise e arquitetura.
2. O plugin seleciona `@heavy`.
3. A sessão principal não tenta implementar ou editar diretamente.
4. Ela delega para `@heavy`.
5. O subagent pesado recebe contexto suficiente e executa a análise.

## Limitações e boas práticas

O plugin não substitui um sistema avançado de aprendizado contínuo como o descrito no paper Agent-as-a-Router. Ele ainda depende de:

- qualidade dos `taskPatterns`;
- bons nomes de modelos em `tiers.json`;
- escolha adequada de `selectorModel`;
- configuração correta de caps;
- teste real no runtime OpenCode.

A recomendação é começar simples:

1. Defina três tiers com modelos reais do seu projeto.
2. Use `costRatio` coerente.
3. Configure `taskPatterns` em inglês e português.
4. Use `hard-block` no início para garantir que a arquitetura funcione.
5. Ajuste os padrões conforme as tarefas reais da sua equipe.

Depois que estiver estável, você pode trocar para `advisory` se quiser apenas orientação, ou manter hard-block para preservar contexto e garantir delegação.

## Conclusão

O opencode-tier-router mostra uma forma prática de aplicar LLM Router dentro do OpenCode: classificar tarefas, escolher o modelo certo, delegar para subagents isolados e impedir que a janela principal execute trabalho pesado.

A ideia central é simples: **não force todos os problemas a passarem pelo mesmo modelo**. Buscas pequenas devem ser baratas e rápidas. Implementações devem usar um modelo adequado a código. Arquitetura, debug complexo e decisões de qualidade devem usar mais capacidade.

Para times que usam OpenCode, Cline, Cody, Continue.dev ou ferramentas semelhantes, a lição é a mesma: router não é apenas otimização de custo. É uma forma de controlar contexto, latência, qualidade e fluxo de trabalho em agentes de programação.

## Modelo utilizado em testes

Outro ponto importante é o modelo utilizado durante o desenvolvimento e testes deste plugin. O **Nex-N2-mini** é um modelo da família Nex, disponível originalmente em https://huggingface.co/nex-agi/Nex-N2-mini. Para este projeto, utilizei a quantização **UD-Q5_K_XL** do fork https://huggingface.co/sjakek/Nex-N2-mini-GGUF, rodando localmente via `llama.cpp`. O resultado foi bastante satisfatório para as tarefas de refatoração, implementação e análise nos tiers `@medium` e `@heavy`, entregando boa qualidade de raciocínio sem depender de APIs externas.

## Referências citadas

- [Agent-as-a-Router: Agentic Model Routing for Coding Tasks](https://arxiv.org/abs/2606.22902), Pengfei Zhou e colaboradores, arXiv 2606.22902.
- [Como o LLM Router Pode Reduzir Custos de Tokens: Técnicas Básicas a Avançadas com LangChain e LangGraph](https://medium.com/@gustavo_tavares99/como-o-llm-router-pode-reduzir-custos-de-tokens-t%C3%A9cnicas-b%C3%A1sicas-a-avan%C3%A7adas-com-langchain-e-3d37e617fbbf), Gustavo Tavares.
- [OpenCode](https://opencode.ai/).
- Post original no [TabNews](https://www.tabnews.com.br/MarcosBritoDev/opencode-router-model-roteando-opencode-para-o-modelo-certo)
