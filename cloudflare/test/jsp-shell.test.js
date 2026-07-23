import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expandJspShell, renderStaticShell } from '../jsp-shell.mjs';

function templateWorkspace(t) {
    const root = mkdtempSync(join(tmpdir(), 'weather-grid-jsp-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
}

test('nested JSP fragments expand and server-only model attributes disappear from the static shell', (t) => {
    const root = templateWorkspace(t);
    const entry = join(root, 'page.jsp');
    writeFileSync(entry, '<%@ page pageEncoding="UTF-8" %><%@ include file="body.jspf" %>');
    writeFileSync(join(root, 'body.jspf'),
        '<%@ include file="label.jspf" %><main data-base-date="${baseDate}" data-context-path="${pageContext.request.contextPath}">지도</main>');
    writeFileSync(join(root, 'label.jspf'), '<h1>기상 지도</h1>');

    assert.match(expandJspShell(entry), /<h1>기상 지도<\/h1>/);
    const rendered = renderStaticShell(entry);
    assert.match(rendered, /<main data-context-path="">지도<\/main>/);
    assert.doesNotMatch(rendered, /<%@|\$\{baseDate\}/);
});

test('JSP fragment expansion rejects paths outside the template root', (t) => {
    const root = templateWorkspace(t);
    const entry = join(root, 'page.jsp');
    writeFileSync(entry, '<%@ include file="../outside.jspf" %>');

    assert.throws(() => expandJspShell(entry), /escapes template root/);
});

test('JSP fragment expansion rejects include cycles', (t) => {
    const root = templateWorkspace(t);
    const entry = join(root, 'page.jsp');
    writeFileSync(entry, '<%@ include file="loop.jspf" %>');
    writeFileSync(join(root, 'loop.jspf'), '<%@ include file="page.jsp" %>');

    assert.throws(() => expandJspShell(entry), /Cyclic JSP include/);
});
