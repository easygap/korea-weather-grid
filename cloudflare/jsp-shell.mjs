import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const INCLUDE_DIRECTIVE = /<%@\s*include\s+file="([^"]+)"\s*%>/gu;

function inside(root, candidate) {
    const pathFromRoot = relative(root, candidate);
    return pathFromRoot === '' || (pathFromRoot !== '..'
        && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot));
}

/**
 * Expands translation-time JSP includes without evaluating arbitrary JSP code.
 * Includes are confined to the entry template directory and cycles fail closed.
 */
export function expandJspShell(entryPath) {
    const entry = resolve(entryPath);
    const root = dirname(entry);

    function visit(filePath, ancestors) {
        const current = resolve(filePath);
        if (!inside(root, current)) throw new Error(`JSP include escapes template root: ${current}`);
        if (ancestors.includes(current)) throw new Error(`Cyclic JSP include: ${[...ancestors, current].join(' -> ')}`);

        const nextAncestors = [...ancestors, current];
        return readFileSync(current, 'utf8').replace(INCLUDE_DIRECTIVE, (_directive, childPath) => {
            return visit(resolve(dirname(current), childPath), nextAncestors);
        });
    }

    return visit(entry, []);
}

/** Converts the shared JSP shell into a CSP-safe static document for Workers. */
export function renderStaticShell(entryPath) {
    const rendered = expandJspShell(entryPath)
        .replace(/<%@[^%]*%>\s*/gu, '')
        .replace(/<%--[\s\S]*?--%>/gu, '')
        .replace(/\sdata-(?:base-date|base-time|file-name)="\$\{(?:baseDate|baseTime|fileName)\}"/gu, '')
        .replaceAll('${pageContext.request.contextPath}', '')
        .replace(/[ \t]+$/gmu, '')
        .trimEnd() + '\n';

    if (rendered.includes('<%') || rendered.includes('${')) {
        throw new Error('Static shell contains an unresolved JSP construct.');
    }
    return rendered;
}
