// Shared header/footer accent colors for the Mis Horas / Mi Reporte pivot
// tables — centralized because both pages repeated the same literals, and
// `headerToday`/`headerWeekend` were darkened from the original #f59e0b/
// #7a9cbf (white text on top gave ~2.1:1 / ~2.9:1 contrast, below WCAG AA's
// 4.5:1 minimum for text this size).
export const PIVOT_COLORS = {
  header: '#0170B9',
  headerBorder: '#005a94',
  headerToday: '#b45309',
  headerWeekend: '#3d5a80',
  footer: '#1e3a5f',
  footerWeekend: '#374151',
} as const
