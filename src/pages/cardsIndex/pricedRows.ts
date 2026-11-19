import { type Accessor, createResource } from 'solid-js';
import { fetchMaster, fetchPricesFor } from '../../lib/data';
import { latestValue } from '../../lib/resource';
import { priceUid } from './sorting';

/**
 * The scope's master, and the rows to show with the prices that go with them.
 * The price read starts with the master's (both share its fetch), and only the
 * coverage check waits for the rows. While a scope switch loads, new rows show
 * unpriced, except while `priceDependent` holds: a price filter or sort keeps
 * the previous rows with their own prices, so a band never reads one scope's
 * rows against another scope's prices.
 */
export function createPricedRows(tournament: Accessor<string>, priceDependent: Accessor<boolean>) {
  const [master, { refetch: refetchMaster }] = createResource(tournament, fetchMaster);
  const [priced, { refetch: refetchPrices }] = createResource(tournament, async t => {
    const items = fetchMaster(t).then(m => m.items);
    const uids = items.then(
      list => list.map(priceUid),
      () => []
    );
    return { prices: await fetchPricesFor(t, uids), items: await items };
  });
  const rows = () => {
    const pair = latestValue(priced);
    const items = latestValue(master)?.items ?? [];
    if (pair?.items === items || (pair && priceDependent())) {
      return pair;
    }
    return { items, prices: undefined };
  };
  // A failed master fails the price read with it, so a retry reruns both.
  const retry = () => {
    void refetchMaster();
    void refetchPrices();
  };
  return { master, rows, retry };
}
