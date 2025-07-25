document.addEventListener('DOMContentLoaded', () => {
    // DOM 元素
    const homeLink = document.getElementById('homeLink');
    const itemGrid = document.getElementById('itemGrid');
    const breadcrumb = document.getElementById('breadcrumb');
    const actionBar = document.getElementById('actionBar');
    const selectionCountSpan = document.getElementById('selectionCount');
    const createFolderBtn = document.querySelector('.create-folder-btn');
    const searchForm = document.getElementById('searchForm');
    const searchInput = document.getElementById('searchInput');
    const multiSelectBtn = document.getElementById('multiSelectBtn');
    const previewBtn = document.getElementById('previewBtn');
    const shareBtn = document.getElementById('shareBtn');
    const renameBtn = document.getElementById('renameBtn');
    const moveBtn = document.getElementById('moveBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const deleteBtn = document.getElementById('deleteBtn');
    const selectAllBtn = document.getElementById('selectAllBtn');
    const previewModal = document.getElementById('previewModal');
    const modalContent = document.getElementById('modalContent');
    const closeModal = document.querySelector('.close-button');
    const moveModal = document.getElementById('moveModal');
    const folderTree = document.getElementById('folderTree');
    const confirmMoveBtn = document.getElementById('confirmMoveBtn');
    const cancelMoveBtn = document.getElementById('cancelMoveBtn');
    const shareModal = document.getElementById('shareModal');
    const uploadModal = document.getElementById('uploadModal');
    const showUploadModalBtn = document.getElementById('showUploadModalBtn');
    const closeUploadModalBtn = document.getElementById('closeUploadModalBtn');
    const uploadForm = document.getElementById('uploadForm');
    const fileInput = document.getElementById('fileInput');
    const fileListContainer = document.getElementById('file-selection-list');
    const folderSelect = document.getElementById('folderSelect');
    const uploadNotificationArea = document.getElementById('uploadNotificationArea');
    const dropZone = document.getElementById('dropZone');
    const dragUploadProgressArea = document.getElementById('dragUploadProgressArea');
    const dragUploadProgressBar = document.getElementById('dragUploadProgressBar');

    // 狀態
    let isMultiSelectMode = false;
    let currentFolderId = 1;
    let selectedItems = new Map();
    let currentFolderContents = { folders: [], files: [] };
    let moveTargetFolderId = null;
    let isSearchMode = false;
    const MAX_TELEGRAM_SIZE = 50 * 1024 * 1024;
    let foldersLoaded = false;

    // --- 輔助函式 ---
    const formatBytes = (bytes, decimals = 2) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    };
    function showNotification(message, type = 'info', container = null) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;

        if (container) {
            notification.classList.add('local');
            container.innerHTML = '';
            container.appendChild(notification);
        } else {
            notification.classList.add('global');
            const existingNotif = document.querySelector('.notification.global');
            if (existingNotif) existingNotif.remove();
            document.body.appendChild(notification);
            setTimeout(() => {
                if (notification.parentElement) notification.parentElement.removeChild(notification);
            }, 5000);
        }
    }
    const loadFolderContents = async (folderId) => {
        try {
            isSearchMode = false;
            if (searchInput) searchInput.value = '';
            itemGrid.innerHTML = '<p>正在加載...</p>';
            currentFolderId = folderId;
            const res = await axios.get(`/api/folder/${folderId}`);
            currentFolderContents = res.data.contents;
            selectedItems.clear();
            renderBreadcrumb(res.data.path);
            renderItems(currentFolderContents.folders, currentFolderContents.files);
            updateActionBar();
        } catch (error) {
            itemGrid.innerHTML = '<p>加載內容失敗。</p>';
        }
    };
    const executeSearch = async (query) => {
        try {
            isSearchMode = true;
            itemGrid.innerHTML = '<p>正在搜尋...</p>';
            const res = await axios.get(`/api/search?q=${encodeURIComponent(query)}`);
            currentFolderContents = res.data.contents;
            selectedItems.clear();
            renderBreadcrumb(res.data.path);
            renderItems(currentFolderContents.folders, currentFolderContents.files);
            updateActionBar();
        } catch (error) {
            itemGrid.innerHTML = '<p>搜尋失敗。</p>';
        }
    };
    const renderBreadcrumb = (path) => {
        breadcrumb.innerHTML = '';
        path.forEach((p, index) => {
            if (index > 0) breadcrumb.innerHTML += '<span class="separator">/</span>';
            if (p.id === null) {
                breadcrumb.innerHTML += `<span>${p.name}</span>`;
                return;
            }
            const link = document.createElement(index === path.length - 1 && !isSearchMode ? 'span' : 'a');
            link.textContent = p.id === 1 ? '根目錄' : p.name;
            if (link.tagName === 'A') {
                link.href = '#';
                link.dataset.folderId = p.id;
            }
            breadcrumb.appendChild(link);
        });
    };
    const renderItems = (folders, files) => {
        itemGrid.innerHTML = '';
        if (folders.length === 0 && files.length === 0) {
            itemGrid.innerHTML = isSearchMode ? '<p>找不到符合條件的檔案。</p>' : '<p>這個資料夾是空的。</p>';
            return;
        }
        folders.forEach(f => itemGrid.appendChild(createItemCard(f)));
        files.forEach(f => itemGrid.appendChild(createItemCard(f)));
    };
    const createItemCard = (item) => {
        const card = document.createElement('div');
        card.className = 'item-card';
        card.dataset.id = item.id;
        card.dataset.type = item.type;
        card.dataset.name = item.name;
        const fullFile = currentFolderContents.files.find(f => f.id === item.id);
        let iconHtml = '';
        if (item.type === 'file' && fullFile && fullFile.thumb_file_id) {
            iconHtml = `<img src="/thumbnail/${item.id}" alt="縮圖" loading="lazy">`;
        } else if (item.type === 'folder') {
            iconHtml = '<i class="fas fa-folder"></i>';
        } else {
            iconHtml = `<i class="fas ${getFileIconClass(item.mimetype)}"></i>`;
        }
        card.innerHTML = `<div class="item-icon">${iconHtml}</div><div class="item-info"><h5 title="${item.name}">${item.name}</h5></div>`;
        if (selectedItems.has(String(item.id))) card.classList.add('selected');
        return card;
    };
    const getFileIconClass = (mimetype) => {
        if (!mimetype) return 'fa-file';
        if (mimetype.startsWith('image/')) return 'fa-file-image';
        if (mimetype.startsWith('video/')) return 'fa-file-video';
        if (mimetype.startsWith('audio/')) return 'fa-file-audio';
        if (mimetype.includes('pdf')) return 'fa-file-pdf';
        if (mimetype.includes('archive') || mimetype.includes('zip')) return 'fa-file-archive';
        return 'fa-file-alt';
    };
    const updateActionBar = () => {
        if (!actionBar) return;
        const count = selectedItems.size;
        selectionCountSpan.textContent = `已選擇 ${count} 個項目`;
        if (downloadBtn) downloadBtn.disabled = count === 0;
        if (previewBtn) previewBtn.disabled = count !== 1 || selectedItems.values().next().value.type === 'folder';
        if (shareBtn) shareBtn.disabled = count !== 1 || selectedItems.values().next().value.type === 'folder';
        if (renameBtn) renameBtn.disabled = count !== 1;
        if (moveBtn) moveBtn.disabled = count === 0 || isSearchMode;
        if (deleteBtn) deleteBtn.disabled = count === 0;
        actionBar.classList.toggle('visible', count > 0);
        if (!isMultiSelectMode && multiSelectBtn) {
            multiSelectBtn.classList.remove('active');
        }
    };
    const rerenderSelection = () => {
        document.querySelectorAll('.item-card').forEach(card => {
            card.classList.toggle('selected', selectedItems.has(card.dataset.id));
        });
    };
    const loadFoldersForUpload = async () => {
        if (foldersLoaded) return;
        try {
            const res = await axios.get('/api/folders');
            const folders = res.data;
            folderSelect.innerHTML = '';
            const folderMap = new Map(folders.map(f => [f.id, { ...f, children: [] }]));
            const tree = [];
            folderMap.forEach(f => {
                if (f.parent_id && folderMap.has(f.parent_id)) folderMap.get(f.parent_id).children.push(f);
                else tree.push(f);
            });
            const buildOptions = (node, prefix = '') => {
                const option = document.createElement('option');
                option.value = node.id;
                option.textContent = prefix + (node.id === 1 ? '/ (根目錄)' : node.name);
                folderSelect.appendChild(option);
                node.children.forEach(child => buildOptions(child, prefix + '　'));
            };
            tree.forEach(buildOptions);
            foldersLoaded = true;
        } catch (error) {
            console.error('加載資料夾列表失敗', error);
        }
    };

    const uploadFiles = async (files, targetFolderId, isDrag = false) => {
        if (files.length === 0) return;

        const oversizedFiles = Array.from(files).filter(file => file.size > MAX_TELEGRAM_SIZE);
        if (oversizedFiles.length > 0) {
            const fileNames = oversizedFiles.map(f => `"${f.name}"`).join(', ');
            showNotification(`檔案 ${fileNames} 過大，超過 ${formatBytes(MAX_TELEGRAM_SIZE)} 的限制。`, 'error', !isDrag ? uploadNotificationArea : null);
            return;
        }

        let existenceData = [];
        try {
            const res = await axios.post('/api/check-existence', { fileNames: Array.from(files).map(f => f.name), folderId: targetFolderId });
            existenceData = res.data.files;
        } catch (error) {
            showNotification('檢查檔案是否存在時出錯。', 'error');
            return;
        }
        
        const filesToUpload = [];
        const filesToOverwrite = [];

        for (const file of Array.from(files)) {
            const existing = existenceData.find(f => f.name === file.name && f.exists);
            if (existing) {
                if (confirm(`檔案 "${file.name}" 已存在。您要覆蓋它嗎？`)) {
                    filesToOverwrite.push({ name: file.name, messageId: existing.messageId });
                    filesToUpload.push(file);
                }
            } else {
                filesToUpload.push(file);
            }
        }

        if (filesToUpload.length === 0) {
            showNotification('已取消，沒有檔案被上傳。', 'info');
            return;
        }

        const formData = new FormData();
        filesToUpload.forEach(file => {
            formData.append('files', file);
        });
        formData.append('folderId', targetFolderId);
        formData.append('overwrite', JSON.stringify(filesToOverwrite));
        
        const captionInput = document.getElementById('uploadCaption');
        if (captionInput && captionInput.value && !isDrag) {
            formData.append('caption', captionInput.value);
        }
        
        const progressBar = isDrag ? dragUploadProgressBar : document.getElementById('progressBar');
        const progressArea = isDrag ? dragUploadProgressArea : document.getElementById('progressArea');
        const submitButton = uploadForm.querySelector('button[type="submit"]');

        progressArea.style.display = 'block';
        progressBar.style.width = '0%';
        progressBar.textContent = '0%';

        if (!isDrag) {
            submitButton.disabled = true;
            submitButton.textContent = '上傳中...';
        } else {
            uploadModal.style.display = 'none';
        }
        
        try {
            const res = await axios.post('/upload', formData, {
                onUploadProgress: p => {
                    const percent = Math.round((p.loaded * 100) / p.total);
                    progressBar.style.width = percent + '%';
                    progressBar.textContent = percent + '%';
                }
            });
            if (res.data.success) {
                showNotification('上傳成功！', 'success');
                loadFolderContents(currentFolderId);
            } else {
                showNotification('上傳失敗', 'error', !isDrag ? uploadNotificationArea : null);
            }
        } catch (error) {
            showNotification('上傳失敗: ' + (error.response?.data?.message || '伺服器錯誤'), 'error', !isDrag ? uploadNotificationArea : null);
        } finally {
            if (!isDrag) {
                submitButton.disabled = false;
                submitButton.textContent = '上傳';
            }
            setTimeout(() => { progressArea.style.display = 'none'; }, 2000);
        }
    };
    
    // --- 事件監聽 ---
    if (uploadForm) {
        fileInput.addEventListener('change', () => {
            fileListContainer.innerHTML = '';
            if (fileInput.files.length > 0) {
                for (const file of fileInput.files) {
                    const listItem = document.createElement('li');
                    listItem.textContent = `${file.name} (${formatBytes(file.size)})`;
                    fileListContainer.appendChild(listItem);
                }
            }
        });

        uploadForm.onsubmit = async function (e) {
            e.preventDefault();
            const files = fileInput.files;
            const targetFolderId = folderSelect.value;
            if (files.length > 0) {
                uploadFiles(files, targetFolderId, false);
            } else {
                showNotification('請選擇要上傳的檔案。', 'error', uploadNotificationArea);
            }
        };
    }
    
    if (dropZone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'));
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'));
        });

        dropZone.addEventListener('drop', (e) => {
            const files = [];
            const items = e.dataTransfer.items;
            let hasFolder = false;
            if (items) {
                for (let i = 0; i < items.length; i++) {
                    const entry = items[i].webkitGetAsEntry();
                    if (entry) {
                        if (entry.isFile) {
                            items[i].getAsFile && files.push(items[i].getAsFile());
                        } else if (entry.isDirectory) {
                            hasFolder = true;
                        }
                    }
                }
            }
            if (hasFolder) {
                showNotification('不支援拖拽資料夾上傳，請選擇檔案。', 'error');
            }
            if (files.length > 0) {
                uploadFiles(files, currentFolderId, true);
            }
        });
    }
    
    // ... (剩下的程式碼與之前相同) ...
    if (homeLink) {
        homeLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.history.pushState(null, '', '/folder/1');
            loadFolderContents(1);
        });
    }
    if (itemGrid) {
        itemGrid.addEventListener('click', e => {
            const card = e.target.closest('.item-card');
            if (!card) return;
            const id = card.dataset.id;
            const type = card.dataset.type;
            const name = card.dataset.name;
            if (isMultiSelectMode) {
                if (selectedItems.has(id)) selectedItems.delete(id);
                else selectedItems.set(id, { type, name });
            } else {
                const isSelected = selectedItems.has(id);
                selectedItems.clear();
                if (!isSelected) selectedItems.set(id, { type, name });
            }
            rerenderSelection();
            updateActionBar();
        });
        itemGrid.addEventListener('dblclick', e => {
            const card = e.target.closest('.item-card');
            if (card && card.dataset.type === 'folder') {
                window.history.pushState(null, '', `/folder/${card.dataset.id}`);
                loadFolderContents(parseInt(card.dataset.id, 10));
            }
        });
    }
    if (breadcrumb) {
        breadcrumb.addEventListener('click', e => {
            e.preventDefault();
            const link = e.target.closest('a');
            if (link && link.dataset.folderId) {
                window.history.pushState(null, '', `/folder/${link.dataset.folderId}`);
                loadFolderContents(parseInt(link.dataset.folderId, 10));
            }
        });
    }
    window.addEventListener('popstate', () => {
        if (document.getElementById('itemGrid')) {
            const folderId = parseInt(window.location.pathname.split('/folder/')[1] || '1', 10);
            loadFolderContents(folderId);
        }
    });
    if (createFolderBtn) {
        createFolderBtn.addEventListener('click', async () => {
            const name = prompt('請輸入新資料夾的名稱：');
            if (name && name.trim()) {
                try {
                    await axios.post('/api/folder', { name: name.trim(), parentId: currentFolderId });
                    loadFolderContents(currentFolderId);
                } catch (error) { alert(error.response?.data?.message || '建立失敗'); }
            }
        });
    }
    if (searchForm) {
        searchForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const query = searchInput.value.trim();
            if (query) executeSearch(query);
            else loadFolderContents(currentFolderId);
        });
    }
    if (multiSelectBtn) {
        multiSelectBtn.addEventListener('click', () => {
            isMultiSelectMode = !isMultiSelectMode;
            multiSelectBtn.classList.toggle('active', isMultiSelectMode);
            if (!isMultiSelectMode && selectedItems.size > 1) {
                const lastItem = Array.from(selectedItems.entries()).pop();
                selectedItems.clear();
                selectedItems.set(lastItem[0], lastItem[1]);
                rerenderSelection();
                updateActionBar();
            }
        });
    }
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            isMultiSelectMode = true;
            if (multiSelectBtn) multiSelectBtn.classList.add('active');
            const allVisibleItems = [...currentFolderContents.folders, ...currentFolderContents.files];
            const allVisibleIds = allVisibleItems.map(item => String(item.id));
            const isAllSelected = allVisibleIds.length > 0 && allVisibleIds.every(id => selectedItems.has(id));
            if (isAllSelected) {
                selectedItems.clear();
            } else {
                allVisibleItems.forEach(item => selectedItems.set(String(item.id), { type: item.type, name: item.name }));
            }
            rerenderSelection();
            updateActionBar();
        });
    }
    if (showUploadModalBtn) {
        showUploadModalBtn.addEventListener('click', async () => {
            await loadFoldersForUpload();
            folderSelect.value = currentFolderId;
            uploadNotificationArea.innerHTML = '';
            uploadForm.reset();
            fileListContainer.innerHTML = '';
            uploadModal.style.display = 'flex';
        });
    }
    if (closeUploadModalBtn) {
        closeUploadModalBtn.addEventListener('click', () => {
            uploadModal.style.display = 'none';
        });
    }
    if (previewBtn) {
        previewBtn.addEventListener('click', async () => {
            if (previewBtn.disabled) return;
            const messageId = selectedItems.keys().next().value;
            const file = currentFolderContents.files.find(f => f.id == messageId);
            if (!file) return;
            previewModal.style.display = 'flex';
            modalContent.innerHTML = '正在加載預覽...';
            const downloadUrl = `/download/proxy/${messageId}`;
            if (file.mimetype && file.mimetype.startsWith('image/')) {
                modalContent.innerHTML = `<img src="${downloadUrl}" alt="圖片預覽">`;
            } else if (file.mimetype && file.mimetype.startsWith('video/')) {
                modalContent.innerHTML = `<video src="${downloadUrl}" controls autoplay></video>`;
            } else if (file.mimetype && file.mimetype.startsWith('text/')) {
                try {
                    const res = await axios.get(`/file/content/${messageId}`);
                    const escapedContent = res.data.replace(/&/g, "&amp;").replace(/</g, "&lt;");
                    modalContent.innerHTML = `<pre><code>${escapedContent}</code></pre>`;
                } catch {
                    modalContent.innerHTML = '無法載入文字內容。';
                }
            } else {
                modalContent.innerHTML = '此檔案類型不支持預覽。';
            }
        });
    }
    if (renameBtn) {
        renameBtn.addEventListener('click', async () => {
             if (renameBtn.disabled) return;
             const [id, item] = selectedItems.entries().next().value;
             const newName = prompt('請輸入新的名稱:', item.name);
             if (newName && newName.trim() && newName !== item.name) {
                 try {
                     if (item.type === 'file') {
                        await axios.post('/rename', { messageId: id, newFileName: newName.trim() });
                     } else {
                         alert('暫不支援重命名資料夾。');
                     }
                     isSearchMode ? executeSearch(searchInput.value.trim()) : loadFolderContents(currentFolderId);
                 } catch (error) {
                     alert('重命名失敗');
                 }
             }
        });
    }
    if (downloadBtn) {
        downloadBtn.addEventListener('click', async () => {
            if (downloadBtn.disabled) return;
            const messageIds = [];
            const folderIds = [];
            selectedItems.forEach((item, id) => {
                if (item.type === 'file') messageIds.push(parseInt(id));
                else folderIds.push(parseInt(id));
            });
            if (messageIds.length === 0 && folderIds.length === 0) return;
            if (messageIds.length === 1 && folderIds.length === 0) {
                window.location.href = `/download/proxy/${messageIds[0]}`;
                return;
            }
            try {
                const response = await axios.post('/api/download-archive', { messageIds, folderIds }, { responseType: 'blob' });
                const url = window.URL.createObjectURL(new Blob([response.data]));
                const link = document.createElement('a');
                link.href = url;
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                link.setAttribute('download', `download-${timestamp}.zip`);
                document.body.appendChild(link);
                link.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(link);
            } catch (error) {
                alert('下載壓縮檔失敗！');
            }
        });
    }
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            if (selectedItems.size === 0) return;
            if (!confirm(`確定要刪除這 ${selectedItems.size} 個項目嗎？\n注意：刪除資料夾將會一併刪除其所有內容！`)) return;
            const filesToDelete = [], foldersToDelete = [];
            selectedItems.forEach((item, id) => {
                if (item.type === 'file') filesToDelete.push(parseInt(id));
                else foldersToDelete.push(parseInt(id));
            });
            try {
                if (filesToDelete.length > 0) await axios.post('/delete-multiple', { messageIds: filesToDelete });
                for (const folderId of foldersToDelete) await axios.post('/api/folder/delete', { folderId });
                isSearchMode ? executeSearch(searchInput.value.trim()) : loadFolderContents(currentFolderId);
            } catch (error) { alert('刪除失敗，請重試。'); }
        });
    }
    if (moveBtn) {
        moveBtn.addEventListener('click', async () => {
            if (selectedItems.size === 0) return;
            try {
                const res = await axios.get('/api/folders');
                const folders = res.data;
                const folderMap = new Map(folders.map(f => [f.id, { ...f, children: [] }]));
                const tree = [];
                folderMap.forEach(f => {
                    if (f.parent_id && folderMap.has(f.parent_id)) folderMap.get(f.parent_id).children.push(f);
                    else tree.push(f);
                });
                folderTree.innerHTML = '';
                const buildTree = (node, prefix = '') => {
                    const item = document.createElement('div');
                    item.className = 'folder-item';
                    item.dataset.folderId = node.id;
                    item.textContent = prefix + (node.id === 1 ? '/ (根目錄)' : node.name);
                    folderTree.appendChild(item);
                    node.children.forEach(child => buildTree(child, prefix + '　'));
                };
                tree.forEach(buildTree);
                moveModal.style.display = 'flex';
                moveTargetFolderId = null;
                confirmMoveBtn.disabled = true;
            } catch { alert('無法獲取資料夾列表。'); }
        });
    }
    if (folderTree) {
        folderTree.addEventListener('click', e => {
            const target = e.target.closest('.folder-item');
            if (!target) return;
            const previouslySelected = folderTree.querySelector('.folder-item.selected');
            if (previouslySelected) previouslySelected.classList.remove('selected');
            target.classList.add('selected');
            moveTargetFolderId = parseInt(target.dataset.folderId);
            confirmMoveBtn.disabled = false;
        });
    }
    if (confirmMoveBtn) {
        confirmMoveBtn.addEventListener('click', async () => {
            if (!moveTargetFolderId) return;
            const itemIds = Array.from(selectedItems.keys()).map(Number);
            try {
                await axios.post('/api/move', { itemIds, targetFolderId: moveTargetFolderId });
                moveModal.style.display = 'none';
                loadFolderContents(currentFolderId);
            } catch (error) { alert('移動失敗'); }
        });
    }
    if (shareBtn && shareModal) {
        const shareOptions = document.getElementById('shareOptions');
        const shareResult = document.getElementById('shareResult');
        const expiresInSelect = document.getElementById('expiresInSelect');
        const confirmShareBtn = document.getElementById('confirmShareBtn');
        const cancelShareBtn = document.getElementById('cancelShareBtn');
        const shareLinkContainer = document.getElementById('shareLinkContainer');
        const copyLinkBtn = document.getElementById('copyLinkBtn');
        const closeShareModalBtn = document.getElementById('closeShareModalBtn');
        shareBtn.addEventListener('click', () => {
            if (shareBtn.disabled) return;
            shareOptions.style.display = 'block';
            shareResult.style.display = 'none';
            shareModal.style.display = 'flex';
        });
        cancelShareBtn.addEventListener('click', () => shareModal.style.display = 'none');
        closeShareModalBtn.addEventListener('click', () => shareModal.style.display = 'none');
        confirmShareBtn.addEventListener('click', async () => {
            const messageId = selectedItems.keys().next().value;
            const expiresIn = expiresInSelect.value;
            try {
                const res = await axios.post('/share', { messageId, expiresIn });
                if (res.data.success) {
                    shareLinkContainer.textContent = res.data.url;
                    shareOptions.style.display = 'none';
                    shareResult.style.display = 'block';
                } else {
                    alert('創建分享鏈接失敗: ' + res.data.message);
                }
            } catch {
                alert('創建分享鏈接請求失敗');
            }
        });
        copyLinkBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(shareLinkContainer.textContent).then(() => {
                copyLinkBtn.textContent = '已複製!';
                setTimeout(() => { copyLinkBtn.textContent = '複製鏈接'; }, 2000);
            });
        });
    }
    if (closeModal) closeModal.onclick = () => {
        previewModal.style.display = 'none';
        modalContent.innerHTML = '';
    };
    if (cancelMoveBtn) cancelMoveBtn.addEventListener('click', () => moveModal.style.display = 'none');
    
    if (document.getElementById('itemGrid')) {
        const initialFolderId = parseInt(window.location.pathname.split('/folder/')[1] || '1', 10);
        loadFolderContents(initialFolderId);
    }
});
