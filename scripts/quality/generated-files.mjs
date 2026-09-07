/** Live datasets belong in R2; synthetic test fixtures remain versioned. */
export function forbiddenGeneratedFiles(files) {
  const forbidden =
    /^(?:\.cache\/|\.venv\/|dist\/|coverage\/|reports\/|static\/(?:reports|players)\/|src\/data\/(?:archetype-icons|format-archetypes)\.json$|public\/assets\/card-synonyms\.json$|public\/assets\/data\/card-types\.json$)/;
  return files.filter(file => forbidden.test(file));
}
