/**
 * textClassifier.js
 *
 * Rule-based structure classifier for lines[] produced by pdf-parse v2 getText().
 *
 * Input : string[] of lines for one page  (may contain empty strings as blank separators)
 * Output: semantic HTML string
 *
 * Rules (evaluated in order, first match wins):
 *
 *  BLANK line          → paragraph break signal (flush current block)
 *
 *  BULLET line         → <li> in <ul>
 *    pattern: starts with •, -, *, ◆, ▸, ▪, or digit+period/paren
 *
 *  NUMBERED list       → <li> in <ol>
 *    pattern: starts with \d+[.)] or [a-z][.)]
 *
 *  HEADING (h1–h4)     → one of:
 *    h1: ALL CAPS, short (≤shortThreshold), no trailing period, standalone
 *    h2: Title Case (every significant word capitalised), short, standalone
 *    h3: short line followed by a blank line OR body text (context look-ahead)
 *    h4: short line ending with ':', or any short bold-marker line
 *        (pdf-parse doesn't give bold, so we use heuristic: short + mixed case + no punct at end)
 *
 *  BODY paragraph      → <p>  (default)
 *
 * Paragraph grouping:
 *   Consecutive non-blank non-heading lines are joined into one <p>.
 *   A blank line always terminates the current paragraph.
 *   A heading always terminates the current paragraph.
 */

// ── Patterns ──────────────────────────────────────────────────────────────

const BULLET_RE  = /^[\u2022\u25CF\u25AA\u25B8\u25AA\u2013\u2014\-\*\u25C6]\s+/;
const OL_RE      = /^(\d+[.)]\s+|[a-zA-Z][.)]\s+|\([a-zA-Z]\)\s+)/;
const SECTION_RE = /^(chapter|section|part|appendix|abstract|introduction|conclusion|references|bibliography)\b/i;
// Significant-word title case: most words start with upper, ignoring short prepositions
const TITLE_CASE_RE = /^(?:[A-Z][a-z]*(?:\s+(?:a|an|the|of|in|on|at|to|for|and|or|but|with|by|from|into|about|as|is|are|was|were|be|been|has|had|have)\b|\s+[A-Z][a-z]*)*)$/;

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * @param {string[]} lines ; raw lines for one page from pdf-parse getText()
 * @param {{medianLineLen:number, shortThreshold:number}} stats
 * @returns {string} HTML
 */
export function classifyLines(lines, stats) {
    const { shortThreshold } = stats;

    // Normalise: trim each line, keep empty lines as paragraph separators
    const norm = lines.map(l => l.trimEnd());

    const parts   = [];
    let paraLines = [];   // accumulating body lines for current <p>
    let listItems = [];   // accumulating <li> items
    let listTag   = null; // 'ul' | 'ol'

    const flushPara = () => {
        if (!paraLines.length) return;
        const text = paraLines.join(' ').replace(/\s+/g, ' ').trim();
        if (text) parts.push(`<p>${esc(text)}</p>`);
        paraLines = [];
    };

    const flushList = () => {
        if (!listItems.length || !listTag) return;
        const tag = listTag;
        const lis = listItems.map(t => `  <li>${esc(t)}</li>`).join('\n');
        parts.push(`<${tag}>\n${lis}\n</${tag}>`);
        listItems = [];
        listTag   = null;
    };

    for (let i = 0; i < norm.length; i++) {
        const line = norm[i];
        const trimmed = line.trim();

        // ── Blank line: flush current block ──────────────────────────────
        if (!trimmed) {
            flushPara();
            flushList();
            continue;
        }

        // ── Bullet list ───────────────────────────────────────────────────
        if (BULLET_RE.test(trimmed)) {
            flushPara();
            if (listTag && listTag !== 'ul') flushList();
            listTag = 'ul';
            listItems.push(trimmed.replace(BULLET_RE, '').trim());
            continue;
        }

        // ── Ordered list ──────────────────────────────────────────────────
        if (OL_RE.test(trimmed)) {
            flushPara();
            if (listTag && listTag !== 'ol') flushList();
            listTag = 'ol';
            listItems.push(trimmed.replace(OL_RE, '').trim());
            continue;
        }

        // ── Heading detection ─────────────────────────────────────────────
        const headingTag = detectHeading(trimmed, i, norm, shortThreshold);
        if (headingTag) {
            flushPara();
            flushList();
            parts.push(`<${headingTag}>${esc(trimmed)}</${headingTag}>`);
            continue;
        }

        // ── Body paragraph ────────────────────────────────────────────────
        flushList();
        paraLines.push(trimmed);
    }

    flushPara();
    flushList();

    return parts.join('\n');
}

// ── Heading detection ──────────────────────────────────────────────────────

/**
 * Returns 'h1'|'h2'|'h3'|'h4'|null
 */
function detectHeading(line, idx, allLines, shortThreshold) {
    const len = line.length;

    // Must be reasonably short to be a heading
    if (len > shortThreshold * 2) return null;

    const endsWithPunct = /[.,:;!?]$/.test(line);
    const isAllCaps     = line === line.toUpperCase() && /[A-Z]/.test(line);
    const isShort       = len <= shortThreshold;
    const nextIsBlank   = !allLines[idx + 1]?.trim();
    const prevIsBlank   = !allLines[idx - 1]?.trim();
    const isSection     = SECTION_RE.test(line);

    // h1: ALL CAPS + short + standalone (blank around it or starts the section)
    if (isAllCaps && isShort && !endsWithPunct) {
        if (prevIsBlank || nextIsBlank || idx === 0) return 'h1';
        return 'h2';
    }

    // h1/h2: known section keywords
    if (isSection && isShort && !endsWithPunct) {
        return isTitleCase(line) ? 'h1' : 'h2';
    }

    // h2: Title Case + short + no trailing punct
    if (isShort && !endsWithPunct && isTitleCase(line) && (prevIsBlank || nextIsBlank)) {
        return 'h2';
    }

    // h3: short line that is preceded by blank + followed by body content
    if (isShort && !endsWithPunct && prevIsBlank) {
        const nextTrimmed = allLines[idx + 1]?.trim() ?? '';
        if (nextTrimmed && nextTrimmed.length > shortThreshold) return 'h3';
    }

    // h4: short line ending with ':'
    if (line.endsWith(':') && isShort) return 'h4';

    return null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Loose title-case check: most words start with upper */
function isTitleCase(line) {
    const words = line.split(/\s+/).filter(w => w.length > 2);
    if (words.length < 1) return false;
    const upWords = words.filter(w => /^[A-Z]/.test(w)).length;
    return upWords / words.length >= 0.6;
}

function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
