# Connectors

## google-analytics — moved

The Google Analytics connector was extracted back to its canonical
repository:

- Gitea (canonical): `gitea.lengoc.me/apps/google-analytics-connector`
- GitHub (mirror): `github.com/ngojclee/google-analytics-connector`

History was preserved via `git subtree split` — all commits prior to the
merge keep their original SHAs. Deploy: Portainer repo-stack `build: .`,
compose path `stack.yml` at the repo root.
