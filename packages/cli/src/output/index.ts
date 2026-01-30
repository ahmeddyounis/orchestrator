import Table from 'cli-table3';

export function printTable(
  data: Record<string, unknown>[],
  options?: Table.TableConstructorOptions,
) {
  const head = options?.head ?? Object.keys(data[0]);
  const table = new Table({ head, ...options });
  data.forEach((row) => table.push(Object.values(row).map((v) => String(v))));
  console.log(table.toString());
}

