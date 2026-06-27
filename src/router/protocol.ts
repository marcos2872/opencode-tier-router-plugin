import type { TaskPatterns } from './config.js';
import { classifyTask as classifyTaskFromPatterns } from './classifier.js';
import { buildDelegationProtocol as buildProtocol } from '../prompts.js';

/**
 * Monta o protocolo de delegação de tarefas em formato Markdown.
 *
 * @param cfg - Configuração do roteador usada para gerar os tiers, regras e instruções de enforcement.
 * @returns Protocolo de delegação que pode ser injetado no sistema do modelo.
 */
export const buildDelegationProtocol = buildProtocol;

/**
 * Classifica uma solicitação de usuário em um tier com base nos padrões de tarefa configurados.
 *
 * @param text - Texto da solicitação a ser classificado.
 * @param taskPatterns - Mapeamento de palavras-chave para os tiers `fast`, `medium` e `heavy`.
 * @returns O tier correspondente ou `null` quando nenhuma regra combinar.
 */
export function classifyTask(text: string, taskPatterns: TaskPatterns): 'fast' | 'medium' | 'heavy' | null {
  return classifyTaskFromPatterns(text, taskPatterns);
}
