/**
 * Armazenamento de Métricas — Camada de Porta/Interface
 *
 * Responsabilidade: Definir abstração para I/O de persistência
 * ✅ Inversão de Dependência: Implementações dependem desta interface
 * Permite alternar armazenamento em arquivo por armazenamento em memória em testes
 */

/**
 * Interface MetricsStorage
 *
 * Abstrai todas as operações de I/O para persistir e carregar métricas.
 * Implementações (FilesystemStorage, InMemoryStorage) ficam em módulos separados.
 */
export interface MetricsStorage {
  /**
   * Salva conteúdo em um arquivo no caminho fornecido.
   * Cria diretórios recursivamente se necessário.
   */
  save(filename: string, content: string): Promise<void>;

  /**
   * Carrega conteúdo de um arquivo no caminho fornecido.
   * Retorna string vazia se o arquivo não existir.
   */
  load(filename: string): Promise<string>;

  /**
   * Lista arquivos em um diretório que correspondem a um padrão.
   * Retorna array vazio se o diretório não existir.
   */
  listFiles(dir: string): Promise<string[]>;

  /**
   * Remove um arquivo no caminho fornecido.
   * Sem ação se o arquivo não existir.
   */
  delete(filename: string): Promise<void>;

  /**
   * Verifica se um arquivo existe no caminho fornecido.
   */
  exists(filename: string): Promise<boolean>;
}
