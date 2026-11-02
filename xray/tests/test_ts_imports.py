from __future__ import annotations

from conftest import Tree
from repo_xray import analyze
from repo_xray.config import Config
from repo_xray.ts_imports import specifiers, strip_comments

TS_WORKSPACE = {
    "apps/web/tsconfig.json": """{
      // comments and trailing commas are allowed in tsconfig
      "compilerOptions": {"baseUrl": ".", "paths": {"@/*": ["./src/*"],},},
    }""",
    "apps/web/src/main.tsx": (
        "import React from 'react';\nimport { App } from './App';\nimport '@/styles';\n"
    ),
    "apps/web/src/App.tsx": (
        "import type { Order } from '@/core/order';\n"
        "import {\n  createClient,\n  type Client,\n} from '@acme/sdk';\n"
        "const Lazy = () => import('./pages/Orders.js');\n"
        "// import { Ghost } from './Ghost';\n"
        "const url = 'http://example.test/x'; // not an import\n"
    ),
    "apps/web/src/styles.ts": "export {};\n",
    "apps/web/src/core/order.ts": "export * from './money';\n",
    "apps/web/src/core/money.ts": "export type Money = number;\n",
    "apps/web/src/pages/Orders.tsx": "const sdk = require('@acme/sdk/client');\n",
    "apps/web/src/types.d.ts": "declare const x: number;\n",
    "packages/sdk/package.json": '{"name": "@acme/sdk", "main": "dist/index.js"}',
    "packages/sdk/src/index.ts": "export * from './client';\n",
    "packages/sdk/src/client.ts": "export const createClient = () => 1;\n",
    "packages/sdk/dist/index.js": "module.exports = {};\n",
}


def test_strip_comments_keeps_strings() -> None:
    source = "const a = '// kept'; // dropped\n/* gone */ const b = \"/* kept */\";"
    stripped = strip_comments(source)
    assert "// kept" in stripped
    assert "/* kept */" in stripped
    assert "dropped" not in stripped
    assert "gone" not in stripped


def test_specifier_forms() -> None:
    source = (
        "import a from 'a';\nimport * as b from \"b\";\nimport 'c';\n"
        "export { d } from './d';\nexport * from './e';\nconst f = await import('f');\n"
        "const g = require('g');\nexport const h = 1;\n"
    )
    assert sorted(specifiers(source)) == ["./d", "./e", "a", "b", "c", "f", "g"]


def test_resolves_relative_alias_workspace_and_js_extension(make_tree: Tree) -> None:
    analysis = analyze(make_tree(TS_WORKSPACE))
    edges = analysis.edges
    assert edges["apps/web/src/main.tsx"] == {"apps/web/src/App.tsx", "apps/web/src/styles.ts"}
    assert edges["apps/web/src/App.tsx"] == {
        "apps/web/src/core/order.ts",
        "packages/sdk/src/index.ts",
        "apps/web/src/pages/Orders.tsx",
    }
    assert edges["apps/web/src/pages/Orders.tsx"] == {"packages/sdk/src/client.ts"}
    assert edges["apps/web/src/core/order.ts"] == {"apps/web/src/core/money.ts"}
    assert analysis.external["react"] == 1
    # Declaration files and build output are not graph nodes.
    assert "apps/web/src/types.d.ts" not in analysis.files
    assert "packages/sdk/dist/index.js" not in analysis.files


def test_configured_alias(make_tree: Tree) -> None:
    root = make_tree(
        {
            "web/src/a.ts": "import { b } from '~/lib/b';\n",
            "web/src/lib/b.ts": "export const b = 1;\n",
        }
    )
    analysis = analyze(root, Config(aliases={"~/": "web/src/"}))
    assert analysis.edges["web/src/a.ts"] == {"web/src/lib/b.ts"}
