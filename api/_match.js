// Comparing song titles and artists loosely: case, accents, "(feat. …)", " - Remastered" and
// punctuation don't count, so "thủy" finds "thuy" and "Love Me Not (feat. X)" is still "love me not".
export function norm(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]/g, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whether two artist lines share an artist ("Mac Miller, Ty Dolla $ign" vs "Mac Miller"). */
export function sameArtist(a, b) {
  const names = (s) => s.split(/,|&| x | feat\.? /i).map(norm).filter(Boolean)
  const bs = names(b)
  return names(a).some((n) => bs.some((m) => m.includes(n) || n.includes(m)))
}
