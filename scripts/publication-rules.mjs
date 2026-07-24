export const FORBIDDEN_PATH_PATTERNS = Object.freeze([
    /(^|\/)\.env(?!\.example$)(?:\.|$)/iu,
    /(^|\/)application-local\.ya?ml$/iu,
    /(^|\/)cloudflare\/public\/(?:static|internal)(?:\/|$)/iu,
    /(?:^|\/)(?:id_rsa|id_ed25519|.*\.(?:p12|pfx|pem|key))$/iu
]);

export const FORBIDDEN_CHART_RUNTIMES = Object.freeze([
    { name: 'Highcharts', pattern: /\bHighcharts\b/iu },
    { name: 'Highcharts Windbarb', pattern: /\bwindbarb(?:\.js)?\b/iu },
    { name: 'Chart.js', pattern: /\bchart(?:\.min)?\.js\b/iu }
]);

const SECRET_INDICATORS = Object.freeze([
    {
        name: 'generic-key-assignment',
        pattern: /\b(?:api|auth|service|secret)[_-]?key\s*[:=]\s*["'][A-Za-z0-9_+/=-]{20,}["']/iu
    },
    {
        name: 'github-token',
        pattern: /\b(?:gh[pousr]_[A-Za-z0-9_.=-]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/iu
    },
    {
        name: 'aws-access-key-id',
        pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u
    },
    {
        name: 'google-api-key',
        pattern: /\bAIza[0-9A-Za-z_-]{35}\b/u
    },
    {
        name: 'private-key-block',
        pattern: /-----BEGIN (?:EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/u
    }
]);

export function isForbiddenPath(path) {
    return FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

export function findForbiddenChartRuntimes(text) {
    return FORBIDDEN_CHART_RUNTIMES
        .filter(({ pattern }) => pattern.test(text))
        .map(({ name }) => name);
}

export function findSecretIndicators(text) {
    return SECRET_INDICATORS
        .filter(({ pattern }) => pattern.test(text))
        .map(({ name }) => name);
}

export function parseDenylist(text) {
    return Object.freeze([...new Set(
        text.split(/\r?\n/u)
            .map((term) => term.trim())
            .filter((term) => term && !term.startsWith('#'))
            .map((term) => term.toLocaleLowerCase('en-US'))
    )]);
}

export function containsDeniedTerm(text, deniedTerms) {
    const normalized = text.toLocaleLowerCase('en-US');
    return deniedTerms.some((term) => normalized.includes(term));
}
