Cada tarefa no modelo certo — e economia de tokens — com LLM Router para OpenCode

Plataformas como OpenCode, Cline e Cody usam o mesmo modelo para tudo — buscar arquivo, refatorar código ou analisar arquitetura. Isso desperdiça tokens e polui a janela de contexto com tarefas de baixo valor cognitivo.

OpenCode é uma plataforma de engenharia assistida por IA onde agentes autônomos escrevem, editam e gerenciam código no terminal.

O opencode-tier-router classifica cada requisição em tiers (@fast, @medium, @heavy) e delega para o modelo mais adequado. Tarefas simples como busca e leitura vão para modelos leves; refatoração e implementação para modelos médios; arquitetura e debug para modelos pesados. O modo hard-block garante que a sessão principal nunca execute trabalho pesado diretamente — ela sempre delega.

Em uma sessão típica com 30 chamadas de ferramenta, ~20 são buscas/leituras (~500-2000 tokens cada). Sem o router, tudo passa pelo modelo caro. Com o router, essas 20 vão para @fast (modelo barato). Economia dupla: menos tokens no modelo caro + contexto principal mais enxuto.

O Nex-N2-mini (quantização UD-Q5_K_XL, via llama.cpp) foi usado localmente nos testes e entrega excelente qualidade para código rodando a 79.82 t/s em média em 40GB de VRAM — sem custo por token além da eletricidade. (link: https://huggingface.co/sjakek/Nex-N2-mini-GGUF)

Links:
- Repositório: https://github.com/marcos2872/opencode-tier-router-plugin
- Post completo no TabNews: https://www.tabnews.com.br/MarcosBritoDev/opencode-router-model-roteando-opencode-para-o-modelo-certo

#LLM #OpenCode #LLMRouter #DevTools #IA #ModelosLocais #llama #MachineLearning #AgentesDeCodigo
