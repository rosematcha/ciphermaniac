/**
 * Whether the CDN says the object does not exist. DigitalOcean Spaces answers
 * a missing key with 403 AccessDenied rather than 404 when listing is off, so
 * that body counts as missing; any other 403 (a bot challenge) does not.
 * @param res - The CDN response
 * @returns True for a missing object
 */
export async function isMissingObject(res: Response): Promise<boolean> {
  if (res.status === 404) {
    return true;
  }
  if (res.status !== 403) {
    return false;
  }
  return (await res.text()).includes('<Code>AccessDenied</Code>');
}
