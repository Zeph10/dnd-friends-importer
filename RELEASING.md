# Releasing an update

1. Make your changes in `scripts/` or `styles/`.
   - To update the Roll20 converter, put the new `converter.py` anywhere and run `python3 tools/build_converter_js.py path/to/converter.py scripts/roll20-converter.js`. Keep the website and the module on the same converter version.
2. In `module.json`, raise `"version"` (for example `0.20.0` → `0.20.1`). Also update `download` to match. The release step fixes it up anyway, but keeping it in step avoids confusion.
3. In GitHub Desktop: write a short summary, click **Commit to main**, then **Push origin**.
4. On GitHub, open the repository and choose **Releases → Draft a new release**.
   - **Tag:** `v0.20.1`, the same version with a `v` in front. Choose "Create new tag on publish".
   - **Title:** `v0.20.1`
   - **Description:** what changed.
   - Click **Publish release**.
5. Wait about a minute. The **Actions** tab shows "Release module" running. When it finishes, the release has `module.json` and `module.zip` attached.
6. In Foundry, **Setup → Add-on Modules → Check for Updates** picks up the new version.

## Installing the module for the first time

In Foundry: **Setup → Add-on Modules → Install Module**, then paste this into **Manifest URL**:

```
https://github.com/Zeph10/dnd-friends-importer/releases/latest/download/module.json
```

## If a release has no files attached

Open the **Actions** tab and look at the failed run. The usual cause is that Actions is blocked from writing. Go to **Settings → Actions → General → Workflow permissions**, choose **Read and write permissions**, then re-run the job.
