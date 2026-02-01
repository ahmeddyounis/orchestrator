export const stripAnsi = (str: string): string => {
  // ANSI escape codes are sequences that start with `\x1b[` and end with a letter.
  // This regex matches these sequences for removal.
  return str.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '');
};
