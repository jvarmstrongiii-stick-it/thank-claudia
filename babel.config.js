module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ({ types: t }) => ({
        visitor: {
          MetaProperty(path) {
            if (
              t.isIdentifier(path.node.meta, { name: 'import' }) &&
              t.isIdentifier(path.node.property, { name: 'meta' })
            ) {
              path.replaceWith(
                t.objectExpression([
                  t.objectProperty(t.identifier('url'), t.stringLiteral('')),
                ])
              );
            }
          },
        },
      }),
    ],
  };
};
