# Deploy TOBACCO To GitHub Pages

This project is ready for GitHub Pages.

## 1. Login Again

Your GitHub CLI token is currently invalid. Run:

```powershell
gh auth login
```

Choose:

```text
GitHub.com
HTTPS
Login with a web browser
```

## 2. Push The Site

After login, run:

```powershell
cd "C:\Users\DELL\Documents\New project\web-platform"
gh repo create TOBACCO-web --public --source . --remote origin --push
```

## 3. Enable Pages Source If Needed

If GitHub asks for Pages source, choose:

```text
GitHub Actions
```

The workflow is already here:

```text
.github/workflows/pages.yml
```

## Expected Link

After deployment, the site should be available at:

```text
https://fhwvtqdc2q-svg.github.io/TOBACCO-web/
```

Use that link on iPhone instead of Cloudflare temporary links.
