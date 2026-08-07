# Migration from the flat Apps Script project

This repository uses `clasp` directories. Google Apps Script supports directory paths when projects are pushed with `clasp`.

## Safe migration

1. In the current Apps Script project, create a deployment backup or download the existing project.
2. Find the Script ID under **Project Settings**.
3. Copy `.clasp.json.example` to `.clasp.json` and paste the Script ID.
4. Run `npm install` and `npm run validate`.
5. Run `npm run gas:pull` into a separate backup folder if you need another local copy.
6. Run `npm run gas:push` from this repository.
7. Open the Apps Script editor and confirm the directory-style filenames appear.
8. Run `warmDashboardCache()` once.
9. Run `installDashboardWarmCacheTrigger()` once if the trigger is not already installed.
10. Deploy a new web-app version.

`clasp push` updates the complete Apps Script project content. Do not point `.clasp.json` at the production Script ID until the repository has passed `npm run validate` and you have a backup.
