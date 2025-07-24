document.addEventListener('DOMContentLoaded', () => {
    // DOM 元素
    const itemGrid = document.getElementById('itemGrid');
    const breadcrumb = document.getElementById('breadcrumb');
    const actionBar = document.getElementById('actionBar');
    const selectionCountSpan = document.getElementById('selectionCount');
    const createFolderBtn = document.querySelector('.create-folder-btn');
    const searchForm = document.getElementById('searchForm');
    const searchInput = document.getElementById('searchInput');

    // 按鈕
    const previewBtn = document.getElementById('previewBtn');
    const shareBtn = document.getElementById('shareBtn');
    const renameBtn = document.getElementById('renameBtn');
    const moveBtn = document.getElementById('moveBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const deleteBtn = document.getElementById('deleteBtn');

    // 移動模態框
    const moveModal = document.getElementById('moveModal');
    const folderTree = document.getElementById('folderTree');
    const confirmMoveBtn = document.getElementById('confirmMoveBtn');
    const cancelMoveBtn = document.getElementById('cancelMoveBtn');

    // 狀態
    let currentFolderId = 1;
    let selectedItems = new Map();
    let currentFolderContents = { folders: [], files: [] };
    let moveTargetFolderId = null;
    let isSearchMode = false;

    // --- 核心功能：加載和渲染 ---
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
            console.error('[DEBUG] 加載內容時捕獲到錯誤:', error);
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
        folders.forEach(f => itemGrid.appendChild(createItemCard(f.id, 'folder', f.name)));
        files.forEach(f => itemGrid.appendChild(createItemCard(f.id, 'file', f.name, f.mimetype)));
    };

    const createItemCard = (id, type, name, mimetype = '') => {
        const card = document.createElement('div');
        card.className = 'item-card';
        card.dataset.id = id;
        card.dataset.type = type;
        card.dataset.name = name;
        const iconHtml = type === 'folder' ? '<i class="fas fa-folder"></i>' : `<i class="fas ${getFileIconClass(mimetype)}"></i>`;
        card.innerHTML = `<div class="item-icon">${iconHtml}</div><div class="item-info"><h5 title="${name}">${name}</h5></div>`;
        if (selectedItems.has(String(id))) card.classList.add('selected');
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
    
    // --- *** 關鍵修正：在 updateActionBar 中加入 null 檢查 *** ---
    const updateActionBar = () => {
        // 如果操作欄不存在於當前頁面，則直接返回
        if (!actionBar) return;

        const count = selectedItems.size;
        selectionCountSpan.textContent = `已選擇 ${count} 個項目`;
        let filesCount = 0, foldersCount = 0;
        selectedItems.forEach(item => item.type === 'file' ? filesCount++ : foldersCount++);
        
        // 在設定 disabled 屬性前，先檢查按鈕是否存在
        if (previewBtn) previewBtn.disabled = count !== 1 || foldersCount === 1;
        if (shareBtn) shareBtn.disabled = count !== 1 || foldersCount === 1;
        if (renameBtn) renameBtn.disabled = count !== 1;
        if (moveBtn) moveBtn.disabled = count === 0 || isSearchMode;
        if (downloadBtn) downloadBtn.disabled = filesCount === 0 || foldersCount > 0;
        if (deleteBtn) deleteBtn.disabled = count === 0;
        
        actionBar.classList.toggle('visible', count > 0);
    };

    // --- 事件監聽 ---
    if (itemGrid) {
        itemGrid.addEventListener('click', e => {
            const card = e.target.closest('.item-card');
            if (!card) return;
            const id = card.dataset.id;
            if (selectedItems.has(id)) {
                selectedItems.delete(id);
                card.classList.remove('selected');
            } else {
                selectedItems.set(id, { type: card.dataset.type, name: card.dataset.name });
                card.classList.add('selected');
            }
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
        // 確保只有在 manager 頁面才執行
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
            if (query) {
                executeSearch(query);
            } else {
                loadFolderContents(currentFolderId);
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
            } catch { alert('無法獲取資料夾列表。'); }
        });
    }
    
    if (folderTree) {
        folderTree.addEventListener('click', e => {
            const target = e.target.closest('.folder-item');
            if (!target) return;
            document.querySelectorAll('#folderTree .folder-item').forEach(el => el.classList.remove('selected'));
            target.classList.add('selected');
            moveTargetFolderId = parseInt(target.dataset.folderId);
            confirmMoveBtn.disabled = false;
        });
    }
    
    if (cancelMoveBtn) cancelMoveBtn.addEventListener('click', () => moveModal.style.display = 'none');
    
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

    // 初始加載（僅在主管理器頁面執行）
    if (document.getElementById('itemGrid')) {
        const initialFolderId = parseInt(window.location.pathname.split('/folder/')[1] || '1', 10);
        loadFolderContents(initialFolderId);
    }
});
