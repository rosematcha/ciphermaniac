import assert from 'node:assert/strict';
import test from 'node:test';

import { BULK_QUESTIONS } from './conformance-bulk-questions.ts';
import { loadRegression } from './conformance-fixtures.ts';
import { replayScenario } from './conformance-replayer.ts';

/** Minimized bulk-corpus scenarios, one or two per corrected divergence, replayed byte-exact at every checkpoint. */
const REGRESSIONS: Readonly<Record<string, { sha256: string; covers: string }>> = {
  'c2-terminal-repair-600325': {
    sha256: 'cb98d8d61269d7a061809ffe9436a4defe2263de44bccd8d652d1da712a184a4',
    covers: 'V25-2: finished elimination standings after a later repair dissolves the final and playoff'
  },
  'c2-third-place-604163': {
    sha256: '14f296fd8a1691b2ee393a1380bc47c7254cd97eb0b93f33ebf46feef1a5b886',
    covers: 'V25-1: zero-win cut players compare Swiss standings after an appended round'
  },
  'c2-depart-semifinalist-603316': {
    sha256: '0d40e2ff2f0c2963deaee1b3715ddd8a91e28b772cc4eaf6bde8a65be3cb1b56',
    covers: 'SPEC 3.6: a table-specific result leaves repeated seats at another table pending'
  },
  'c1-501076': {
    sha256: '2ffaaa3afa42351afe0575822ac386ee5bfaf16cbbeabdce89476a0d51828b92',
    covers: 'V19-3: an opening cut repair records the finalists’ division playoff even with cross-division candidates'
  },
  's2-terminal-repair-313676': {
    sha256: 'e6b0192c3ec10eb45bdb2341621ef4ad42116af81cf77e0708f0b3662f02489e',
    covers: 'V25-1: equal-win cut players after a Swiss round appended during the cut'
  },
  's2-result-refused-313866': {
    sha256: '330669524b303fab94cabfc996eb856d5e3172e6aa6dde98125b37cf61c7b86f',
    covers: 'V25-1: the same after a bracket with a bye and a playoff-only round'
  },
  's2-depart-finalist-302463': {
    sha256: 'fa18c5efbe92bf346d1142bc47d1f519053bb62a584ef4fa9441dc582c92cbf4',
    covers: 'storing several pending results returns an acknowledged round to 4 before it completes'
  },
  's2-terminal-repair-307950': {
    sha256: '0bda2c711f4f4e6cba0d82b556f5f1397a8d3e263763f403caa422a4e48456d0',
    covers: 'a refused elimination entry leaves the round stage'
  },
  's2-terminal-pairing-309931': {
    sha256: 'df7dcea70e07942de28827ccdb75e0d84bed419ce40ce1f7d5e4eabc27e256ea',
    covers: 'a finished event whose round was reopened pairs again'
  },
  's2-terminal-repair-312121': {
    sha256: '52c3aa7ff69d897f59451df7db6aa5e7a5383629386e5c2f6f021b477b606fca',
    covers: 'starting the top cut after a Swiss round appended during the cut pairs the cut'
  },
  's2-depart-finalist-314519': {
    sha256: '52f8d24b725035fc6bf706349557f4546665d1fe9300c23dd76e0e01068d7b03',
    covers: 'a double loss gives neither player a head-to-head win'
  },
  's2-depart-semifinalist-302477': {
    sha256: '9a7a3a2f59a328bde52f2e95067b5e9bd69e4959d9363914bb1045e88e7937c3',
    covers: 'results apply to repeated seats by table'
  },
  's2-depart-bye-holder-312802': {
    sha256: '0bf6698f61a647cad68e1b157e894f154547a3f6bbcf372866ad896f1ba66003',
    covers: 'a recorded head-to-head order ends when results separate its group'
  },
  's2-terminal-repair-309129': {
    sha256: '9ed80fce3da32601ff0c1db7c5cd30e07247ea3164e61de6d00d5b6d73e4b09e',
    covers: 'a later cut repair pairs each player of a repeated final once'
  },
  's2-terminal-pairing-303973': {
    sha256: '49593f66f580c115692436b73b446de6f6804761205a18edc7cceb2b3ec411ba',
    covers: 'equal disqualified names follow the roster order of the reopened file'
  },
  's2-depart-semifinalist-311136': {
    sha256: 'd39a6cb1b788cd2280614e8acd6d3f57a3da96a680b8fbfc92c576690aa81cfe',
    covers: 'V24-1: the cut round after a Swiss round appended during the cut draws a new bracket'
  },
  's2-terminal-pairing-314064': {
    sha256: '51961e7583c6ed59c0b78abc5888f49fb96ec59ee6aa03830c94984137dfffd5',
    covers: 'V24-2: a stored win that empties the cut list adds nobody until a check refills it'
  },
  's2-third-place-305231': {
    sha256: '6045b42061d50e311aca720ff92a85d3211f2d7ac365b9b69b987edde2758c0b',
    covers: 'V24-3: a later cut repair of an odd field pairs its playoff from the dissolved final'
  },
  's2-terminal-repair-306206': {
    sha256: '9e768b263872847004f34434a547cd2e4b7748da047bb0f3981add614757b58f',
    covers: "V24-4: a repaired opening round keeps its decided final's table in S2"
  },
  's2-depart-loser-306450': {
    sha256: '3cd7145ed612ac7605c26cc77bde6920e18ba8263ffa08069c3c14426aaa8e62',
    covers: 'V24-5: a group the third-place comparison cannot order takes its saved order'
  },
  's2-depart-finalist-304846': {
    sha256: '03ea75eaf29ac56150dc0dbb416089c5cb3c136ba8d33ed0688dd35037b57b7d',
    covers: 'V24-6: a refilled cut list keeps the cut unfinished'
  },
  's2-terminal-pairing-302302': {
    sha256: 'f05c53018cce968968ac2a6650e749dbae26a1275b15343f781fcb1fd325daee',
    covers: "V24-7: a return appends an abandoned search's match as recorded"
  },
  's2-terminal-repair-306284': {
    sha256: '4e1c444b95a5094034db4595249929a2a2993828c7c6ab3bac81d236a0491b13',
    covers: 'V24-8: mutual latest opponents skip the opponent comparison'
  },
  's2-depart-loser-311949': {
    sha256: '061deed710f9cbd8cbe52ec953c31e3bdabc8f12a96328f06a2807f190b2ebb6',
    covers: "V24-9: a head-to-head cycle at the cut's selection takes the recorded seeds"
  },
  's3-repair-403681': {
    sha256: '82de3778bceb3b64c28aac6c4f474e56deb49890f7e7fa1784e4afcf950ee739',
    covers: 'the wizard keeps its overflow proposal when automatic numbering is cleared'
  },
  's3-terminal-414436': {
    sha256: 'b2cc3ff512aa58d37cbf7b463ce08ceab83325506dbb58d071bcd8669ee86e24',
    covers: 'a terminal repair reuses the tables of the round it repairs'
  },
  's3-terminal-415160': {
    sha256: 'e4b664435e7271fe6b99333e91cbb54814daa512075892c0f4e4ff1f0cd7f34b',
    covers: 'V23-4: the table of a kept final when an elimination-only terminal repair draws again'
  },
  's3-terminal-404902': {
    sha256: '30e3bf28e429d8b43b6994c25475102f95b3c3dffb438c8fedb28059d58b4dfc',
    covers: "a repair's recorded stage shows its pool pairing took the completed matches apart"
  },
  's3-elimtables-407930': {
    sha256: 'be33fff9a449ae12ce99dbe9b85a53ac49459c544df9e050af91911c5e80f088',
    covers: 'V22-2: a Prerelease type 3 cut in S3 starts after the type 3 Swiss count'
  },
  's3-depart-413593': {
    sha256: 'ad65b8e2886bafa1a2b83b4b9983efdc867b6adfd4036e7b4961fadc62eb2199',
    covers: 'V22-2: the wizard offers one less Swiss round on the type 3 count in a Prerelease'
  },
  's3-third-413310': {
    sha256: '2ab7f93bcdd254ce1906ce03ce4a07ac8b324fbe9f2a0d4b8d74fe40ef1a2e88',
    covers: 'V23-2: a cut match numbered at overflow start 0'
  },
  's3-late-406601': {
    sha256: '0b7a75cfff63aa992feb3563d55fcab820b9d8c2185f25897300dd89a314399c',
    covers: "V23-3: a later flight's match past the overflow start in a manual-numbering repair"
  },
  's1-200142': {
    sha256: '9dfa1fbed4ec22e084c9108add8f588ef7b5baffe319dfb990a2bae2abb14531',
    covers: 'a reopened League Challenge saved with a cut keeps its cut'
  },
  's1-202617': {
    sha256: '1faf2665e86576fbb46e7e16df1bc01aa4ec9929502cab4a9313fdfd68963892',
    covers: 'a reopened League Challenge saved with a cut plays the type 3 Swiss count'
  },
  's1-215474': {
    sha256: 'e283815bd7a395552144146c4ede5addd8602bbc447e52306238a7844482f0ba',
    covers: 'a type 2 event saved with one less Swiss round plays every round'
  },
  's1-212740': {
    sha256: '061f8dd10f39896178707c0176796671db6218adf3ff7042a36e1f05d243dcc2',
    covers: 'the Prerelease play another round acknowledgment writes 7 over a pending match'
  },
  's1-209202': {
    sha256: '7034bfbb4971d4afdebba8a2c3653ac55f1f62bb3898ed62f4858a606c63b8e9',
    covers: 'V22-2: a Prerelease type 3 cut starts after the type 3 Swiss count'
  },
  's1-203325': {
    sha256: 'e3ed727b49818b3efcc150781031e7aa8bd247da0a4cc67c3373b65c2f793d6b',
    covers: 'V22-2: a Prerelease type 3 pod without a cut is done at the type 3 Swiss count'
  },
  's1-218116': {
    sha256: 'efed966f72f4de9abc412bd957da438d99190905351c3b74434dd211512b1ac3',
    covers: 'V22-3: an earlier round without matches keeps its stage when the file is reopened'
  },
  's1-218488': {
    sha256: 'b736dd5b9ebb4ba1695d373d51529032bffeff320cb64b6d6459be61a4773d37',
    covers: 'V22-4: a failed attempt leaves its random bye with the only player who could hold it'
  },
  's1-217152': {
    sha256: 'daed9eb0c4a5d114d5ff27dcdf29c75a81d1c61a0df7f0533a5ccd8ed48286dc',
    covers: 'V22-5: a random bye paired since the last reading can be followed by a second one'
  },
  'bx7-flights-113996': {
    sha256: '9631053409601791949dd29c4092d37038bc7cca08fa77161e7e1d168652be88',
    covers: 'a flight repair of a finished pod orders only the matches present, then numbers in final order'
  },
  'bx4-cutflights-53870': {
    sha256: 'd82b9fd6ddff8bc60b06ff8758b00ba02c1b9006acb53fe22908928ecfe0d4d7',
    covers: "a later flight's unrecorded match keeps its place while a flight pass numbers in recorded order"
  },
  'by7-league-122127': {
    sha256: '617631dfc5734464989fb82346e76313892b0cfb3f37fae5a4ed158a78c4f535',
    covers: 'V22-1: a departure that leaves a player without a record keeps them out of the cut'
  },
  'bx6-manualrepairs-93928': {
    sha256: 'a3697c40c289f3a546ec517212b000eb5dee1c484dc4f8a728fbcb07e869b941',
    covers: 'a repaired opening round leaves finished standings until a reopening'
  },
  'bx6-terminal-91347': {
    sha256: 'a302259293c715b3aae4b4f7daf8ec36d760151ff12f99f6c505fc597663cf51',
    covers: 'V21-1: an elimination-only pairing counts the awarded player it seats'
  },
  'by5-rounds-81933': {
    sha256: '0b125ad326360697358f28f9a6f9aa88c242824d28d52614c1681255dc1bfe5a',
    covers: 'completed opening repairs preserve repeated retained byes'
  },
  'bx5-elimrepairs-73812': {
    sha256: 'ee13d85882fa47b781d9f8866e7e39be98dee235d37fea8fe14ba00c45a03f3f',
    covers: 'later elimination repairs require exactly two players to attempt a playoff'
  },
  'by5-cut-83599': {
    sha256: '6997e45c912bce0c1540abf4c798c68b86c83a5bc7d7b564236977317e78f565',
    covers: 'a repeated playoff appends survivor IDs again before numbering'
  },
  'by5-divcuts-82671': {
    sha256: 'ed055def9fb26833180cc2a4f23947cb03d85945a9a369fe71e2f760a3ecf908',
    covers: 'V20-1: departures after a search restart can keep pending Swiss matches'
  },

  'bx4-terminal-51413': {
    sha256: '10a6107e4c0f21b74f6d2275af9bd2b38176a5673f89fbdb7d18e8200dbcbf17',
    covers: 'a flight numbering pass moves other flights out of the range'
  },
  'bx4-terminal-52188': {
    sha256: '05ab46d86f3871dbf03d0879c638c9d97a40a7e28063be5358b35a47aeb797fc',
    covers: 'a departed random-bye holder returns to the flight repair pool'
  },
  'bx4-repairs-52942': {
    sha256: '1a7625e93827a691d6affb6c4c4be0e7c46ab4df06d65a532c3b8ba07aef2a25',
    covers: 'a single pod keeps its range ceiling with a zero overflow start'
  },
  'bx4-elimflights-51923': {
    sha256: '9f24f273132463dbac930a88a812159b0263c86fd2d0bf63c57726801d43ddde',
    covers: 'a repaired pair of departed players leaves the second seat a bye'
  },
  'bx4-returns-52260': {
    sha256: '4331ab7524e6fe622eec8dcd9a5aea1b826f5203cdcf5c2e6b358d62ab9bec88',
    covers: 'a departure or return that sets no result keeps the acknowledged stage'
  },
  'bx3-late-31737': {
    sha256: 'd6e8eb91109e03d11a57361958eb4504fb17ef049d3f513dbaf6381d46faa384',
    covers: 'repair numbering reserves overflow survivors until their final numbering pass'
  },
  'bx3-byes-32968': {
    sha256: '157af6d1910c5742737184db2509d6acd9af78a982648f5f647e7c86eb8cc327',
    covers: 'terminal repair infers unchanged survivor choices before numbering outside the range'
  },
  'bx3-seats-31731': {
    sha256: 'ac1f690a3878cf06ea5d57ee25695b68544261a79a23b38172c10dc783a02f81',
    covers: 'explicit report acknowledgments preserve pending outcomes'
  },
  'by3-divcuts-41230': {
    sha256: '8bb1511e943fed4c8b395a5731e2570c6368b829fe5dcc021f703ffb30165df2',
    covers: 'reopened pending cut contenders retain their neighbouring table allowance'
  },
  'bx2-probes-09332': {
    sha256: '744c60f7a154ccab8ba60725ff195b1369af949d8efffc9f9a93862206e8adab',
    covers: 'elimination-only pairing stops after the scheduled rounds'
  },
  'bx2-topcut-10572': {
    sha256: '21ce3844910ec3e5b4aa261d461a20ec06aae852fdecf8210f209fb95af3291c',
    covers: 'a clock sample starts the clock of a round completed without a start'
  },
  'by2-bracket-09008': {
    sha256: 'e1da999f46160824af7b78d26bfce66dfa09feb6efcf3891557b041d9f6db0d0',
    covers: 'a round completed by departures without a start can be reopened'
  },
  'by2-swiss-08038': {
    sha256: '975653978df6bc44ec0c51563b4e3fd28d487752584def15cbc5a9d18bf2fdf6',
    covers: 'an aborted opening of assigned byes keeps those awards consumed'
  },
  'by2-reopen-07874': {
    sha256: '369078b7788ade2749f7b1e63fb23841a9de779ca025efd075a1f5a03a9d10f9',
    covers: 'a repeated departure concedes an elimination match restored to pending'
  },
  'bx2-seats-09290': {
    sha256: '958832aaf59cc1962a90c79ccfa6f5f3980873010764a14ee99efafda7493ec6',
    covers: 'elimination winners are entered in saved match order, not table order'
  },
  'by1-cut-00645': {
    sha256: '505c3f73f17dd82efedfff6510db4714a5f6191d35b2f460d891cc475476372c',
    covers: 'a pending cut departure preserves both contenders after a reload'
  },
  'bx1-league-01594': {
    sha256: 'dc7d1d4efcbc26b2926ca6ceda8d8cb9cd6d26f6cea21deb1b50ece359536c6b',
    covers: 'an appended semifinal bye does not conceal the actual playoff'
  },
  'by2-reopen-08308': {
    sha256: 'b120e736d04fbf56a369a967e753eef671955ef5fb52aae3a39aa1b2d3e99afa',
    covers: 'an opening bracket with byes is not a semifinal playoff'
  },
  'bx2-sizes-09105': {
    sha256: '7ed67a735e21a748543087bc21bfae0a1b4f224f8bf07fefda4455bf80ea98cb',
    covers: 'a singleton elimination event cannot append Swiss'
  },
  'bx2-topcut-09630': {
    sha256: 'caefb63f0727df199ec27c601330dd142af2d4b1d86ba5f9c1f5390a4e821cd3',
    covers: 'the wizard disables fewer Swiss rounds below four planned rounds'
  },
  'bx2-returns-09435': {
    sha256: '1fd8d0b78a446100266acc689e6490380ff74620fadb7d24f821ff7916287cf5',
    covers: 'a return fills the missed round after the last played round'
  },
  'bx2-probes-10704': {
    sha256: 'f15b5f245639185e117895bc4e9293e800c5cc909841163d44d84862f9897c2c',
    covers: 'removing the sole pending match preserves an empty round stage'
  },
  'bx2-repairs-09912': {
    sha256: 'f5b92cd5e17ec762590115418c08ed591458b1b8b720eb22a7dfd876566700cb',
    covers: 'elimination-only opening matches claim static tables'
  },
  'bx2-seats-10029': {
    sha256: '18c5065557d4a787ac81b67690402a150435d6e3bb33b3c7016b54f690d51225',
    covers: 'duplicate static tables retain only unchanged repair seats'
  },
  'bx1-pairing-01978': {
    sha256: '4547159d3e2688a69f6be22a52ab77e15a734df04c779895f68dc4e9e73f5ae6',
    covers: 'an opening flight of assigned byes starts the event without a round'
  },
  'bx1-refusals-00364': {
    sha256: 'ae1f87d91d9ad0a719114ed8dbceabebb8e3d6336b41abce7ca39e042367b924',
    covers: 'a paused round keeps a result entered in the main window pending'
  },
  'bx1-clocks-00691': {
    sha256: 'd559895c4f81cbebe60b07f9f8376dc9f56ceac22583a27a6688a3ca54d048df',
    covers: 'a round started after a clock sample uses the fixed clock'
  },
  'bx1-clocks-02665': {
    sha256: 'a9e89abaa07db69a11e6c7e5420714ee095fe2d89f9c2670131b48edd1b9bbd3',
    covers: 'reopening saves an unstarted round at its full length'
  },
  'bx1-clocks-01526': {
    sha256: 'b6c8445c42e8c9d9c333e0c279ce0a7005419ad761a37b383dbabb5d13c1b6de',
    covers: 'a clock sample shifts only the addressed pod'
  },
  'bx1-tables-01172': {
    sha256: '2c03209abb8663de9297bbff3ee8f79c747cf87adf0cb1c1513ebea29a7c5e8a',
    covers: 'direct configuration numbers automatically beside registered static seats'
  },
  'bx1-clocks-02860': {
    sha256: '259828410763b94df18449dbdab27cb0bb5065d21690c64950c512211263c1d5',
    covers: 'direct configuration writes zero-minute round times'
  },
  'bx1-departures-00626': {
    sha256: '67311631360c61fd0901bb72901731bb288a53dff96ef4d5f9a75d844d00a4c4',
    covers: 'a return counts the absence from the last round the player played'
  },
  'by1-pods-00387': {
    sha256: 'a3f958d5f0659163d7c14a242bb5f780bc1d299993ca0462ed769fd86541fb07',
    covers: 'only a division with a cut records its paired playoff'
  },
  'by1-degenerate-00899': {
    sha256: '811566dfeabcaae40e16dcb3ae9469d32553c18dfcaeec7356fa75cee9dd5f87',
    covers: 'an ordinary drop is refused once the elimination opponent departed'
  },
  'by1-elimination-01180': {
    sha256: '359f1a48b95c6e824f8c6ce7a8517f87fb981f3deae6e411d77f7a0569d56d3a',
    covers: 'a repeated drop against a departed elimination opponent is refused'
  },
  'bx1-departures-02331': {
    sha256: 'a8caf11a021fa9b51fd004984bcfdb939684412f6302927b4095c6c3a2370817',
    covers: 'a pod without a cut refuses another round after Swiss unchanged'
  },
  'bx1-departures-00497': {
    sha256: 'e62bd50e689b22ba2c9bd0db15b895c987cade73bbb834298572e1bae7faff15',
    covers: 'the cut starts from a complete unacknowledged last Swiss round'
  },
  'bx1-pairing-01628': {
    sha256: 'a02c9c3e7bd059d7c70e40a5de75d56cc99be40f4d0bcbff4eeaf8492fd71486',
    covers: 'starting the cut releases the tables of a finished pod'
  },
  'bx1-late-00997': {
    sha256: 'f409d0996e5d05d3ad3346d5244ac8f2a131bdb047491aeb6acf28bf821aea6e',
    covers: 'an acknowledged complete odd round repairs to itself'
  },
  'bx1-tables-02298': {
    sha256: 'ec06398b21eaa2869056fd6309ae88e391e781d7f6ca5e3c132177796a9dd5b1',
    covers: 'a finished event repairs an acknowledged round to itself'
  },
  'by1-degenerate-01580': {
    sha256: '271b6113111a007556a957f0f387adf236ca5c336721f2eb03ed9093125b34d3',
    covers: 'reopened elimination-only survivors include unpaired entrants'
  },
  'bx1-departures-00538': {
    sha256: 'b92d0bc157494af105f5591e244e8cf7ac47e5fa092a598c0659e400a0586c55',
    covers: 'a restored pending elimination result keeps both players alive'
  },
  'bx1-departures-01299': {
    sha256: '45944e51415bc123ce3dbdc6490555717ad52edf24de3ed7f2a985f1ef1ec780',
    covers: 'a recorded bye can sit above the lowest bracket'
  },
  'bx1-late-01586': {
    sha256: 'c0d86cbf35a30f38237367b58351fbc5efbfed705b7ebedb8764863173c60fbc',
    covers: 'a division recounted on reopening reaches the saved cut entries'
  },
  'bx1-byes-02254': {
    sha256: '4d654a40e77d9178825ea0645761ad593f6fb194f803f45426066e14124a9996',
    covers: 'a recorded head-to-head order lapses once a member departs'
  },
  'bx1-departures-02028': {
    sha256: '725e998a81dbf442186d1287f1c5bc92e4a235e1fdd5ca441ab38324e72a46ba',
    covers: 'an elimination tie order applies only to its own checkpoint'
  },
  'by1-league-00565': {
    sha256: '3dc6e28915eba40b9026e3b0b1cf68c26359aaec8f806347474244cdd6ccb1f6',
    covers: 'a reopened cut whose final was restored to pending has no champion'
  }
};

for (const [id, { sha256, covers }] of Object.entries(REGRESSIONS)) {
  test(`TOM bulk regression ${id}: ${covers}`, () => {
    assert.deepEqual(replayScenario(loadRegression(id, sha256), { questions: BULK_QUESTIONS }), []);
  });
}
