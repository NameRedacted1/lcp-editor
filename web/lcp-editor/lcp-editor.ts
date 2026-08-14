import { currentCategory, chooseFormat, createNewPack, buildReferenceIndex, initDB, newItemFor, renderLibrary, restoreOpenDraft, setPackTabsEnabled, showToast, wirePanelToggles, wireWorkspaceControls } from './state.js';
import { switchTab, addItemToCurrentCategory, wirePartPicker } from './ui.js';
import { flushPackSave, autoIdFor, autoIdItems, layoutDeclaresId, uniqueAutoId } from './forms.js';
import { exportPack, handleZipUpload, closeImportModal, confirmImport, openImportModal, runConversion } from './io.js';
import { closeEidolonTargetModal, confirmEidolonTarget, closeAssemblerModal, openEidolonTargetModal, runEidolonAssembler } from './eidolon.js';

async function bootstrap() {
  setPackTabsEnabled(false);
  await initDB();
  wireWorkspaceControls();
  wirePanelToggles();

  document.querySelectorAll('.tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.currentTarget as HTMLButtonElement;
      if (!target.disabled) switchTab(target.dataset.tab!);
    });
  });
  
  document.getElementById('upload-zip')!.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      void handleZipUpload(input.files[0]);
      input.value = '';
    }
  });
  
  document.getElementById('btn-new-pack')!.addEventListener('click', () => {
    void chooseFormat().then((format) => {
      if (format === null) return;
      return createNewPack(format);
    });
  });

  await buildReferenceIndex();
  await restoreOpenDraft();

  document.getElementById('btn-export')!.addEventListener('click', exportPack);
  document.getElementById('btn-convert')!.addEventListener('click', () => void runConversion());

  document.getElementById('btn-import-item')!.addEventListener('click', openImportModal);
  document.getElementById('btn-import-cancel')!.addEventListener('click', closeImportModal);
  document.getElementById('btn-import-confirm')!.addEventListener('click', confirmImport);

  document.getElementById('btn-add-item')!.addEventListener('click', () => {
    if (!currentCategory) return;
    const item = newItemFor(currentCategory);
    if (layoutDeclaresId(currentCategory) && item !== null && typeof item === 'object') {
      item.id = uniqueAutoId(currentCategory, autoIdFor(currentCategory, String(item.name ?? '')), item);
      autoIdItems.add(item);
    }
    void addItemToCurrentCategory(item);
  });

  document.getElementById('btn-assemble-cancel')!.addEventListener('click', closeAssemblerModal);
  document.getElementById('btn-assemble-confirm')!.addEventListener('click', () => {
    void runEidolonAssembler();
  });

  document.getElementById('btn-create-eidolon')!.addEventListener('click', () => {
    void openEidolonTargetModal();
  });
  document.getElementById('btn-eidolon-target-cancel')!.addEventListener('click', closeEidolonTargetModal);
  document.getElementById('btn-eidolon-target-confirm')!.addEventListener('click', confirmEidolonTarget);

  wirePartPicker();

  window.addEventListener('pagehide', () => {
    flushPackSave();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPackSave();
  });

  renderLibrary();
}

if (typeof document !== 'undefined') {
  void bootstrap().catch(() => {
    showToast('Editor storage unavailable');
  });
}
