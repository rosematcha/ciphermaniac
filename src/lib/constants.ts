// Folder key for the rolling online-meta aggregate. Matches the upstream
// `reports/{name}/` path on R2 exactly, so it doubles as a tournament-list
// entry and a fetch path.
export const ONLINE_META_NAME = 'Online - Last 14 Days';

// Display label for the online meta. Purely cosmetic — the storage key still
// uses the plain string above; nothing parses this label back into a key.
export const ONLINE_META_LABEL = 'Online ladder · last 14 days';
