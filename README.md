# Research discovery lab

A follow-along lab for the talk *Making research easier to find*. A participant
works through stations that match the slides: the author records that identify
you, closing the loop between a profile and a website, the crawling and
indexing checks, AI crawler access, explaining the ideas behind the papers,
testing the route with an assistant, and keeping the record coherent.

Live at <https://sgilson7.github.io/research-discovery-lab/>.

**Nothing is required and nothing is sent anywhere.** Every task can be skipped,
and a whole station can be skipped in one click. The details a participant types
are used to build direct links to their own records — their ORCID page, their
Semantic Scholar author page, the OpenAlex record their ORCID resolves to — and
are kept in `localStorage` on that device. The page sets a
Content-Security-Policy whose `connect-src` is `'self'` and whose `form-action`
is `'none'`, so it has no route to another origin.

## Layout

| Path | What it is |
|---|---|
| `index.html` | The page. Static, no build step, no framework, no npm. |
| `app.js` | Builds the links from the typed details, tracks task state, writes the summary. |
| `style.css` | One stylesheet. System fonts, no webfont fetch. |
| `data/stations.json` | **Every string a participant reads.** Changing the lab is a data edit. |

## Running it

Any static server:

```sh
python3 -m http.server 8080
```

## Deploying

GitHub Pages, from the default branch root. No build step, so what is in the
repository is what is served.
