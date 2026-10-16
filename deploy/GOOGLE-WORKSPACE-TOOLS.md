# Google Workspace Tool Matrix

Generated from explicit reviewed policy; unknown tools deny. Account pinned server-side for every allowed tool.

| Tool | Required Hub scope | Additional gate / denial | Google OAuth any-of ceiling |
| --- | --- | --- | --- |
| addComment | workspace:write | Upstream schema validation | drive.file, drive |
| addDataValidation | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| addDimensionGroup | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| addDocumentTab | workspace:write | Upstream schema validation | documents, drive.file, drive |
| addGoogleSheetConditionalFormat | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| addNamedRange | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| addPermission | DENY | Sharing administration | drive.file, drive |
| addSheet | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| addSpreadsheetSheet | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| appendSpreadsheetRows | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| applyParagraphStyle | workspace:write | Upstream schema validation | documents, drive.file, drive |
| applyTextStyle | workspace:write | Upstream schema validation | documents, drive.file, drive |
| authGetStatus | DENY | Authentication administration | N/A |
| authListScopes | DENY | Authentication administration | N/A |
| authTestFileAccess | DENY | Authentication administration | N/A |
| autoResizeColumns | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| autoResizeRows | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| batchUpdateGoogleSheetValues | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| bulkConvertFolderPdfs | workspace:write | Upstream schema validation | drive.file, drive |
| convertPdfToGoogleDoc | workspace:write | Upstream schema validation | drive.file, drive |
| copyFile | workspace:write | Upstream schema validation | drive.file, drive |
| createCalendarEvent | workspace:write | Upstream schema validation | calendar, calendar.events |
| createDocFromHTML | workspace:write | Upstream schema validation | drive.file, drive |
| createFolder | workspace:write | Upstream schema validation | drive.file, drive |
| createFootnote | workspace:write | Upstream schema validation | documents, drive.file, drive |
| createGmailDraft | gmail:draft:create | Upstream schema validation | gmail.compose |
| createGoogleDoc | workspace:write | Upstream schema validation | documents, drive.file, drive |
| createGoogleSheet | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| createGoogleSlides | workspace:write | Upstream schema validation | presentations, drive.file, drive |
| createGoogleSlidesShape | workspace:write | Upstream schema validation | presentations, drive.file, drive |
| createGoogleSlidesTextBox | workspace:write | Upstream schema validation | presentations, drive.file, drive |
| createParagraphBullets | workspace:write | Upstream schema validation | documents, drive.file, drive |
| createShortcut | workspace:write | Upstream schema validation | drive.file, drive |
| createTextFile | workspace:write | Upstream schema validation | drive.file, drive |
| deleteCalendarEvent | DENY | Destructive operation needs approval contract | calendar, calendar.events |
| deleteComment | DENY | Destructive operation needs approval contract | drive.file, drive |
| deleteDimensionGroup | DENY | Destructive operation needs approval contract | spreadsheets, drive.file, drive |
| deleteGoogleSlide | DENY | Destructive operation needs approval contract | presentations, drive.file, drive |
| deleteItem | DENY | Destructive operation needs approval contract | drive.file, drive |
| deleteRange | DENY | Destructive operation needs approval contract | documents, drive.file, drive |
| deleteSheet | DENY | Destructive operation needs approval contract | spreadsheets, drive.file, drive |
| deleteSlideElement | DENY | Destructive operation needs approval contract | presentations, drive.file, drive |
| describeGoogleDocRange | workspace:read | Upstream schema validation | documents, drive.readonly, drive.file, drive |
| downloadFile | DENY | Server filesystem write | drive.readonly, drive.file, drive |
| duplicateSlide | workspace:write | Upstream schema validation | presentations, drive.file, drive |
| editTableCell | workspace:write | Upstream schema validation | documents, drive.file, drive |
| exportSlideThumbnail | workspace:read | Upstream schema validation | presentations, drive.readonly, drive.file, drive |
| findAndReplaceInDoc | workspace:write | Upstream schema validation | documents, drive.file, drive |
| formatGoogleDocParagraph | workspace:write | Upstream schema validation | documents, drive.file, drive |
| formatGoogleDocText | workspace:write | Upstream schema validation | documents, drive.file, drive |
| formatGoogleSheetCells | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| formatGoogleSheetNumbers | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| formatGoogleSheetText | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| formatGoogleSlidesParagraph | workspace:write | Upstream schema validation | presentations, drive.file, drive |
| formatGoogleSlidesText | workspace:write | Upstream schema validation | presentations, drive.file, drive |
| getCalendarEvent | workspace:read | Upstream schema validation | calendar.readonly, calendar, calendar.events |
| getCalendarEvents | workspace:read | Upstream schema validation | calendar.readonly, calendar, calendar.events |
| getComment | workspace:read | Upstream schema validation | drive.readonly, drive.file, drive |
| getDocumentInfo | workspace:read | Upstream schema validation | documents, drive.readonly, drive.file, drive |
| getGmailMessage | gmail:read | Upstream schema validation | gmail.readonly |
| getGoogleDocContent | workspace:read | Upstream schema validation | documents, drive.readonly, drive.file, drive |
| getGoogleDocContentPaginated | workspace:read | Upstream schema validation | documents, drive.readonly, drive.file, drive |
| getGoogleDocImage | workspace:read | Upstream schema validation | documents, drive.readonly, drive.file, drive |
| getGoogleDocStyleSummary | workspace:read | Upstream schema validation | documents, drive.readonly, drive.file, drive |
| getGoogleSheetCells | workspace:read | Upstream schema validation | spreadsheets, drive.readonly, drive.file, drive |
| getGoogleSheetContent | workspace:read | Upstream schema validation | spreadsheets, drive.readonly, drive.file, drive |
| getGoogleSlidesContent | workspace:read | Upstream schema validation | presentations, drive.readonly, drive.file, drive |
| getGoogleSlidesSpeakerNotes | workspace:read | Upstream schema validation | presentations, drive.readonly, drive.file, drive |
| getRevisions | workspace:read | Upstream schema validation | drive.readonly, drive.file, drive |
| getSlideElementInfo | workspace:read | Upstream schema validation | presentations, drive.readonly, drive.file, drive |
| getSpreadsheetInfo | workspace:read | Upstream schema validation | spreadsheets, drive.readonly, drive.file, drive |
| hideSheetDimension | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| insertImageFromUrl | DENY | Unreviewed server URL fetch | documents, drive.file, drive |
| insertLocalImage | DENY | Server filesystem read | documents, drive.file, drive |
| insertSlidesImageFromUrl | DENY | Unreviewed URL ingestion | presentations, drive.file, drive |
| insertSlidesLocalImage | DENY | Server filesystem read | presentations, drive.file, drive |
| insertSmartChip | workspace:write | Upstream schema validation | documents, drive.file, drive |
| insertTable | workspace:write | Upstream schema validation | documents, drive.file, drive |
| insertText | workspace:write | Upstream schema validation | documents, drive.file, drive |
| listCalendars | workspace:read | Upstream schema validation | calendar.readonly, calendar, calendar.events |
| listComments | workspace:read | Upstream schema validation | drive.readonly, drive.file, drive |
| listDimensionGroups | workspace:read | Upstream schema validation | spreadsheets, drive.readonly, drive.file, drive |
| listDocumentTabs | workspace:read | Upstream schema validation | documents, drive.readonly, drive.file, drive |
| listFolder | workspace:read | Upstream schema validation | drive.readonly, drive.file, drive |
| listGmailDrafts | gmail:read | Upstream schema validation | gmail.readonly, gmail.compose |
| listGoogleDocs | workspace:read | Upstream schema validation | drive.readonly, drive.file, drive |
| listGoogleSheets | workspace:read | Upstream schema validation | drive.readonly, drive.file, drive |
| listPermissions | workspace:read | Upstream schema validation | drive.readonly, drive.file, drive |
| listSharedDrives | workspace:read | Upstream schema validation | drive.readonly, drive.file, drive |
| listSheets | workspace:read | Upstream schema validation | spreadsheets, drive.readonly, drive.file, drive |
| lockFile | DENY | Access administration | drive.file, drive |
| manage_accounts | DENY | Account administration; all actions denied | N/A |
| mergeGoogleSheetCells | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| moveItem | workspace:write | Upstream schema validation | drive.file, drive |
| moveSlideElement | workspace:write | Upstream schema validation | presentations, drive.file, drive |
| protectRange | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| readGoogleDoc | workspace:read | Upstream schema validation | documents, drive.readonly, drive.file, drive |
| readGoogleDocPaginated | workspace:read | Upstream schema validation | documents, drive.readonly, drive.file, drive |
| readSmartChips | workspace:read | Upstream schema validation | documents, drive.readonly, drive.file, drive |
| readTextFile | workspace:read | Upstream schema validation | drive.readonly, drive.file, drive |
| removePermission | DENY | Sharing administration | drive.file, drive |
| renameDocumentTab | workspace:write | Upstream schema validation | documents, drive.file, drive |
| renameItem | workspace:write | Upstream schema validation | drive.file, drive |
| renameSheet | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| reorderSlides | workspace:write | Upstream schema validation | presentations, drive.file, drive |
| replaceAllTextInSlides | workspace:write | Upstream schema validation | presentations, drive.file, drive |
| replaceSlideImage | DENY | Mixed local path / URL operation; both denied | presentations, drive.file, drive |
| replyToComment | workspace:write | Reply and resolve both require write | drive.file, drive |
| restoreRevision | DENY | Destructive operation needs approval contract | drive.file, drive |
| search | workspace:read | Upstream schema validation | drive.readonly, drive.file, drive |
| searchGmailMessages | gmail:read | Upstream schema validation | gmail.readonly |
| setColumnWidth | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| setElementText | workspace:write | Upstream schema validation | presentations, drive.file, drive |
| setElementZOrder | workspace:write | Only BRING_TO_FRONT, BRING_FORWARD, SEND_BACKWARD, SEND_TO_BACK | presentations, drive.file, drive |
| setGoogleSheetBorders | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| setGoogleSlidesBackground | workspace:write | Upstream schema validation | presentations, drive.file, drive |
| setRowHeight | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| setSlideVisibility | workspace:write | Upstream schema validation | presentations, drive.file, drive |
| shareFile | DENY | Sharing administration | drive.file, drive |
| showSheetDimension | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| styleDocTable | workspace:write | Upstream schema validation | documents, drive.file, drive |
| styleGoogleSlidesShape | workspace:write | Upstream schema validation | presentations, drive.file, drive |
| unlockFile | DENY | Access administration | drive.file, drive |
| updateCalendarEvent | workspace:write | Upstream schema validation | calendar, calendar.events |
| updateDimensionGroup | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| updateGoogleDoc | workspace:write | Overwrites content; write permission is mutating authority | documents, drive.file, drive |
| updateGoogleSheet | workspace:write | Upstream schema validation | spreadsheets, drive.file, drive |
| updateGoogleSheetIfUnchanged | workspace:write | dryRun and commit both require write | spreadsheets, drive.file, drive |
| updateGoogleSlides | workspace:write | Replaces slides/content; write permission is mutating authority | presentations, drive.file, drive |
| updateGoogleSlidesSpeakerNotes | workspace:write | Upstream schema validation | presentations, drive.file, drive |
| updatePermission | DENY | Sharing administration | drive.file, drive |
| updateTextFile | workspace:write | Upstream schema validation | drive.file, drive |
| uploadFile | workspace:write | contentBase64 only; localPath denied | drive.file, drive |
| uploadPdfWithSplit | DENY | Server filesystem read | drive.file, drive |
