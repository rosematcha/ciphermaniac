<p align="center">
  <a href="https://ciphermaniac.com"><img src="static/logo.svg" alt="Ciphermaniac" width="96"></a>
</p>

<h1 align="center">Ciphermaniac</h1>

<p align="center"><a href="https://ciphermaniac.com">ciphermaniac.com</a></p>

Ciphermaniac enables in-depth, responsive analysis of online Pokémon events, using daily static compiles of data rather than making constant real-time calls in service of speed. It also provides slicker interfaces for viewing trends in the game, player history, and events.

## How it works

Ciphermaniac serves pre-digested JSON readouts of event data. The [workflows README](.github/workflows/README.md) covers what each job does and when it runs. The data is yours to use however you like: read the [API documentation](https://r2.ciphermaniac.com/) for more details.

## Running it

```bash
git clone https://github.com/rosematcha/ciphermaniac.git
cd ciphermaniac
npm install
npm run dev
```

You'll need Node 22. `npm run dev` covers every page with live data and no credentials. Run `npm run dev:functions` in a second terminal if you need the `/api` endpoints.

Before opening a PR, run `npm run verify`. It's everything CI runs: types, lint, dead code, build, and tests. The Python tests need `pip install -r .github/scripts/requirements.txt` first.

## Supporting the site

I run Ciphermaniac as a personal side project, with absolutely no ads and operating completely out of my teacher's salary. If you've found the site to be helpful, I'd love your support via [my TCGPlayer affiliate link](https://partner.tcgplayer.com/c/6491809/1780961/21018) or [Ko-Fi](https://ko-fi.com/ciphermaniac).

## Thanks to...

- [LimitlessTCG](https://limitlesstcg.com/), [PlayLimitless](https://play.limitlesstcg.com/), and [Robin](https://x.com/limitless_robin), for providing tournament data, a slick online tournament portal, and fundamentally changing how the game is talked about and played.
- [TCGCSV](https://tcgcsv.com/) and CptSpaceToaster, for providing CSV-formatted, publicly-accessible TCGPlayer market prices, especially as TCGPlayer locks down their API.
- [TrainerHill](https://trainerhill.com) and Brad, for interface inspiration and extremely helpful support in early development.
- [Pokédata.ovh](https://pokedata.ovh) and Julien, for incredible real-time data work on events past, present, and future.

MIT licensed. Ciphermaniac is not, and does not claim to be, affiliated with The Pokémon Company, Nintendo, Game Freak, Creatures Inc., or RK9.
