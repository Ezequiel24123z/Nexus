import fs from 'node:fs';
import path from 'node:path';

// Parses CHANGELOG.md into a structured timeline of releases & categorized entries
// for the visual Changelog & Release Timeline view inside NEXUS.
export function parseChangelogMarkdown(markdown = '') {
  const lines = String(markdown || '').split(/\r?\n/);
  const releases = [];
  let currentRelease = null;
  let currentSection = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const relMatch = /^##\s+\[?v?([0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.]+)?)\]?(?:\s*[-–—]\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|[^\s]+))?/.exec(line);
    if (relMatch) {
      currentRelease = {
        version: relMatch[1],
        date: relMatch[2] || '',
        sections: [],
        totalItems: 0,
      };
      releases.push(currentRelease);
      currentSection = null;
      continue;
    }
    if (!currentRelease) continue;

    const secMatch = /^###\s+(.+)$/.exec(line);
    if (secMatch) {
      const title = secMatch[1].trim();
      const kind = /security|hardening/i.test(title) ? 'security'
        : /fix|bug/i.test(title) ? 'fixed'
        : /chang|improv|refact|perf/i.test(title) ? 'improved'
        : 'added';
      currentSection = { title, kind, items: [] };
      currentRelease.sections.push(currentSection);
      continue;
    }

    const bulletMatch = /^(\s*)-\s+(.+)$/.exec(line);
    if (bulletMatch) {
      if (!currentSection) {
        currentSection = { title: 'Highlights', kind: 'added', items: [] };
        currentRelease.sections.push(currentSection);
      }
      const indent = bulletMatch[1].length;
      const body = bulletMatch[2].trim();
      if (indent >= 2 && currentSection.items.length > 0) {
        currentSection.items[currentSection.items.length - 1].details.push(body);
      } else {
        const boldMatch = /^\*\*([^*]+)\*\*:?\s*(.*)$/.exec(body);
        currentSection.items.push({
          title: boldMatch ? boldMatch[1].trim() : '',
          text: boldMatch ? boldMatch[2].trim() : body,
          raw: body,
          details: [],
        });
        currentRelease.totalItems++;
      }
    }
  }

  return releases;
}

export function loadChangelog(desktopRoot) {
  const candidates = [
    path.join(desktopRoot, 'CHANGELOG.md'),
    path.join(desktopRoot, '..', 'CHANGELOG.md'),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      return { source: file, raw, releases: parseChangelogMarkdown(raw) };
    }
  }
  return { source: null, raw: '', releases: [] };
}
