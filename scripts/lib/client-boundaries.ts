import ts from "typescript";
import path from "node:path";

// Follow local runtime imports, including barrels and dynamic imports. Checking
// the whole client closure also protects shared Node modules used by the worker.
export function clientBoundaryViolations(root: string) {
  const configFile = ts.readConfigFile(
    path.join(root, "tsconfig.json"),
    ts.sys.readFile,
  );
  if (configFile.error) throw new Error("Cannot read TypeScript config");
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
  const violations = new Set<string>();
  const visited = new Set<string>();
  function visit(file: string) {
    file = path.resolve(file);
    if (
      visited.has(file) ||
      file.includes(`${path.sep}node_modules${path.sep}`)
    )
      return;
    visited.add(file);
    const relative = path.relative(root, file);
    if (/^src\/(server|worker)\//.test(relative)) {
      violations.add(`Client imports server module: ${relative}`);
      return;
    }
    const source = ts.createSourceFile(
      file,
      ts.sys.readFile(file) ?? "",
      ts.ScriptTarget.Latest,
      true,
    );
    function follow(specifier: string) {
      if (
        /^(node:|server-only$|pg$|pg-boss$|drizzle-orm(?:\/|$))/.test(specifier)
      ) {
        violations.add(
          `Client imports server dependency: ${relative} -> ${specifier}`,
        );
        return;
      }
      const resolved = ts.resolveModuleName(
        specifier,
        file,
        config.options,
        ts.sys,
      ).resolvedModule;
      if (resolved) visit(resolved.resolvedFileName);
    }
    function scan(node: ts.Node) {
      if (
        ts.isImportDeclaration(node) &&
        !node.importClause?.isTypeOnly &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const bindings = node.importClause?.namedBindings;
        const onlyTypes =
          bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((entry) => entry.isTypeOnly) &&
          !node.importClause?.name;
        if (!onlyTypes) follow(node.moduleSpecifier.text);
      }
      if (
        ts.isExportDeclaration(node) &&
        !node.isTypeOnly &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        follow(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      ) {
        const value = node.arguments[0];
        if (value && ts.isStringLiteral(value)) follow(value.text);
        else violations.add(`Nonliteral client import: ${relative}`);
      }
      if (
        ts.isPropertyAccessExpression(node) &&
        node.getText(source).startsWith("process.env.") &&
        !["NODE_ENV"].includes(node.name.text)
      ) {
        violations.add(
          `Client environment access must use an explicit public DTO: ${relative}`,
        );
      }
      ts.forEachChild(node, scan);
    }
    scan(source);
  }
  for (const file of config.fileNames) {
    if (!path.relative(root, file).startsWith("src/")) continue;
    const source = ts.createSourceFile(
      file,
      ts.sys.readFile(file) ?? "",
      ts.ScriptTarget.Latest,
      true,
    );
    if (
      source.statements.some(
        (statement) =>
          ts.isExpressionStatement(statement) &&
          ts.isStringLiteral(statement.expression) &&
          statement.expression.text === "use client",
      )
    )
      visit(file);
  }
  return [...violations];
}
