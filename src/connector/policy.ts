export const scopes = ['workspace:read', 'workspace:write', 'gmail:read', 'gmail:draft:create'] as const;
export const policy: Record<string, string[]> = Object.create(null);
const allow = (scope: string, names: string) => {
  for (const name of names.split(' ')) policy[name] = [scope];
};
// Explicit reviewed inventory, never inferred from prefixes or upstream defaults.
allow('workspace:read', 'search listFolder listSharedDrives listPermissions getRevisions readTextFile readGoogleDoc readGoogleDocPaginated listDocumentTabs listComments getComment getGoogleDocContent getGoogleDocContentPaginated getGoogleDocImage listGoogleDocs getDocumentInfo getGoogleDocStyleSummary describeGoogleDocRange readSmartChips getGoogleSheetContent getGoogleSheetCells getSpreadsheetInfo listSheets listGoogleSheets listDimensionGroups getGoogleSlidesContent getGoogleSlidesSpeakerNotes getSlideElementInfo exportSlideThumbnail listCalendars getCalendarEvents getCalendarEvent');
allow('workspace:write', 'createTextFile updateTextFile createFolder renameItem moveItem copyFile uploadFile convertPdfToGoogleDoc bulkConvertFolderPdfs createShortcut createGoogleDoc createDocFromHTML updateGoogleDoc insertText applyTextStyle applyParagraphStyle formatGoogleDocText formatGoogleDocParagraph createParagraphBullets findAndReplaceInDoc addComment replyToComment insertTable editTableCell styleDocTable addDocumentTab renameDocumentTab insertSmartChip createFootnote createGoogleSheet updateGoogleSheet batchUpdateGoogleSheetValues updateGoogleSheetIfUnchanged formatGoogleSheetCells formatGoogleSheetText formatGoogleSheetNumbers setGoogleSheetBorders mergeGoogleSheetCells addGoogleSheetConditionalFormat appendSpreadsheetRows addSpreadsheetSheet addSheet renameSheet addDataValidation protectRange addNamedRange setColumnWidth setRowHeight autoResizeColumns autoResizeRows hideSheetDimension showSheetDimension addDimensionGroup updateDimensionGroup createGoogleSlides updateGoogleSlides formatGoogleSlidesText formatGoogleSlidesParagraph styleGoogleSlidesShape setGoogleSlidesBackground createGoogleSlidesTextBox createGoogleSlidesShape updateGoogleSlidesSpeakerNotes duplicateSlide reorderSlides replaceAllTextInSlides moveSlideElement setSlideVisibility setElementZOrder setElementText createCalendarEvent updateCalendarEvent');
allow('gmail:read', 'searchGmailMessages getGmailMessage listGmailDrafts');
allow('gmail:draft:create', 'createGmailDraft');

export const blocked: Record<string, string> = {
  manage_accounts: 'Account administration; all actions denied',
  authGetStatus: 'Authentication administration', authListScopes: 'Authentication administration',
  authTestFileAccess: 'Authentication administration',
  downloadFile: 'Server filesystem write', insertLocalImage: 'Server filesystem read',
  insertSlidesLocalImage: 'Server filesystem read', uploadPdfWithSplit: 'Server filesystem read',
  insertImageFromUrl: 'Unreviewed server URL fetch', insertSlidesImageFromUrl: 'Unreviewed URL ingestion',
  replaceSlideImage: 'Mixed local path / URL operation; both denied',
  deleteItem: 'Destructive operation needs approval contract', deleteRange: 'Destructive operation needs approval contract',
  deleteComment: 'Destructive operation needs approval contract', deleteSheet: 'Destructive operation needs approval contract',
  deleteDimensionGroup: 'Destructive operation needs approval contract', deleteGoogleSlide: 'Destructive operation needs approval contract',
  deleteSlideElement: 'Destructive operation needs approval contract', deleteCalendarEvent: 'Destructive operation needs approval contract',
  restoreRevision: 'Destructive operation needs approval contract',
  addPermission: 'Sharing administration', updatePermission: 'Sharing administration',
  removePermission: 'Sharing administration', shareFile: 'Sharing administration',
  lockFile: 'Access administration', unlockFile: 'Access administration',
};

export function authorized(name: string, granted: readonly string[], args?: Record<string, unknown>): boolean {
  if (!Object.prototype.hasOwnProperty.call(policy, name) || !policy[name].every(s => granted.includes(s))) return false;
  if (!args) return true;
  // Upstream account selection supports fan-out; connector pins default account only.
  if (Object.prototype.hasOwnProperty.call(args, 'account')) return false;
  if (name === 'uploadFile' && (Object.prototype.hasOwnProperty.call(args, 'localPath') || typeof args.contentBase64 !== 'string' || !args.contentBase64)) return false;
  if (name === 'setElementZOrder' && !['BRING_TO_FRONT', 'BRING_FORWARD', 'SEND_BACKWARD', 'SEND_TO_BACK'].includes(String(args.operation))) return false;
  return true;
}
