export { getDocumentClient, getTableName } from "./client";
export {
  asStoreFailure,
  DataStoreUnavailableError,
  GuessAlreadyActiveError,
  GuessAlreadyResolvedError,
} from "./errors";
export { createGuess, getOrCreatePlayer, getPlayer, resolveGuess } from "./players";
