/**
 * The intent/purpose of a memory retrieval operation.
 * Used to optimize retrieval strategies based on the use case.
 *
 * - `verification`: Retrieving context for verifying code correctness
 * - `implementation`: Retrieving context for implementing features
 * - `planning`: Retrieving context for planning tasks
 */
export type RetrievalIntent = 'verification' | 'implementation' | 'planning';
