document.addEventListener('DOMContentLoaded', () => {
    // DOM 元素獲取
    const itemGrid = document.getElementById('itemGrid');
    const breadcrumb = document.getElementById('breadcrumb');
    const previewModal = document.getElementById('previewModal');
    const modalContent = document.getElementById('modalContent');
    const closeModal = document.querySelector('.close-button');
    const actionBar = document.getElementById('actionBar');
    const selectionCountSpan = document.getElementById('selectionCount');
    const selectAllBtn = document.getElementById('selectAllBtn');
    const createFolderBtn = document.querySelector('.create-folder-btn');
    
    // 操作按鈕
    const previewBtn = document.getElementById('previewBtn');
    const shareBtn = document.getElementById('shareBtn');
    const renameBtn = document.getElementById('renameBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const deleteBtn = document.getElementById('deleteBtn');

    // 狀態管理
    let currentFolderId = 1;
    let selectedItems = new Map(); // 使用 Map 來儲存選擇的項目 { id, type }
    let currentFolderContents = { folders: [], files: [] };

    // --- 核心功能：加載和渲染 ---

    const loadFolderContents = async (folderId) => {
        try {
            itemGrid.innerHTML = '<p>正在加載...</p>';
            currentFolderId = folderId;
            const res = await axios.get(`/api/folder/${folderId}`);
            
            currentFolderContents = res.data.contents;
            selectedItems.clear(); // 切換目錄時清空選擇

            renderBreadcrumb(res.data.path);
            renderItems(currentFolderContents.folders, currentFolderContents.files);
            updateActionBar();
        } catch (error) {
            itemGrid.innerHTML = '<p>加載內容失敗，請稍後重試。</p>';
        }
    };

    const renderBreadcrumb = (path) => {
        breadcrumb.innerHTML = '';
        path.forEach((p, index) => {
            if (index > 0) {
                breadcrumb.innerHTML += '<span class="separator">/</span>';
            }
            if (index === path.length - 1) {
                breadcrumb.innerHTML += `<span>${p.name}</span>`;
            } else {
                breadcrumb.innerHTML += `<a href="#" data-folder-id="${p.id}">${p.name}</a>`;
            }
        });
    };

    const renderItems = (folders, files) => {
        itemGrid.innerHTML = '';
        if (folders.length === 0 && files.length === 0) {
            itemGrid.innerHTML = '<p>這個資料夾是空的。</p>';
            return;
        }

        // 渲染資料夾
        folders.forEach(folder => {
            const card = createItemCard(folder.id, 'folder', folder.name);
            itemGrid.appendChild(card);
        });

        // 渲染檔案
        files.forEach(file => {
            const card = createItemCard(file.id, 'file', file.name, file.mimetype);
            itemGrid.appendChild(card);
        });
    };

    const createItemCard = (id, type, name, mimetype = '') => {
        const card = document.createElement('div');
        card.className = 'item-card';
        card.dataset.id = id;
        card.dataset.type = type;
        card.dataset.name = name; // 用於重命名

        let iconHtml = '';
        if (type === 'folder') {
            iconHtml = '<i class="fas fa-folder"></i>';
        } else {
            // 縮圖邏輯可以後續加入
            iconHtml = `<i class="fas ${getFileIconClass(mimetype)}"></i>`;
        }

        card.innerHTML = `
            <div class="item-icon">${iconHtml}</div>
            <div class="item-info"><h5 title="${name}">${name}</h5></div>
        `;
        
        if (selectedItems.has(String(id))) {
            card.classList.add('selected');
        }

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


    // --- 狀態更新 ---

    const updateActionBar = () => {
        const count = selectedItems.size;
        selectionCountSpan.textContent = `已選擇 ${count} 個項目`;

        let selectedFilesCount = 0;
        let selectedFoldersCount = 0;
        selectedItems.forEach(item => {
            if (item.type === 'file') selectedFilesCount++;
            if (item.type === 'folder') selectedFoldersCount++;
        });

        previewBtn.disabled = count !== 1 || selectedFoldersCount === 1;
        shareBtn.disabled = count !== 1 || selectedFoldersCount === 1;
        renameBtn.disabled = count !== 1;
        downloadBtn.disabled = selectedFilesCount === 0;
        deleteBtn.disabled = count === 0;
        
        actionBar.classList.toggle('visible', count > 0);
    };

    // --- 事件監聽 ---

    // 點擊項目（選擇/取消選擇）
    itemGrid.addEventListener('click', (e) => {
        const card = e.target.closest('.item-card');
        if (!card) return;
        
        const id = card.dataset.id;
        const type = card.dataset.type;

        if (selectedItems.has(id)) {
            selectedItems.delete(id);
            card.classList.remove('selected');
        } else {
            selectedItems.set(id, { type });
            card.classList.add('selected');
        }
        updateActionBar();
    });

    // 雙擊項目（進入資料夾）
    itemGrid.addEventListener('dblclick', (e) => {
        const card = e.target.closest('.item-card');
        if (card && card.dataset.type === 'folder') {
            loadFolderContents(parseInt(card.dataset.id, 10));
        }
    });

    // 點擊麵包屑導航
    breadcrumb.addEventListener('click', (e) => {
        e.preventDefault();
        const link = e.target.closest('a');
        if (link && link.dataset.folderId) {
            loadFolderContents(parseInt(link.dataset.folderId, 10));
        }
    });

    // 建立新資料夾
    createFolderBtn.addEventListener('click', async () => {
        const folderName = prompt('請輸入新資料夾的名稱：');
        if (folderName && folderName.trim()) {
            try {
                await axios.post('/api/folder', {
                    name: folderName.trim(),
                    parentId: currentFolderId
                });
                loadFolderContents(currentFolderId); // 重新加載
            } catch (error) {
                alert(error.response?.data?.message || '建立資料夾失敗');
            }
        }
    });
    
    // 刪除按鈕
    deleteBtn.addEventListener('click', async () => {
        if (selectedItems.size === 0) return;
        if (!confirm(`確定要刪除這 ${selectedItems.size} 個項目嗎？\n注意：刪除資料夾將會一併刪除其所有內容！`)) return;

        const filesToDelete = [];
        const foldersToDelete = [];
        selectedItems.forEach((item, id) => {
            if (item.type === 'file') filesToDelete.push(parseInt(id, 10));
            // 刪除資料夾的 API 需要在後端實現遞歸刪除
            // 此處暫時僅處理檔案刪除
            if (item.type === 'folder') {
                alert('暫不支援直接刪除資料夾，請先清空資料夾內容。');
            }
        });

        if (filesToDelete.length > 0) {
            try {
                await axios.post('/delete-multiple', { messageIds: filesToDelete });
                loadFolderContents(currentFolderId); // 重新加載
            } catch (error) {
                alert('刪除檔案失敗。');
            }
        }
    });

    // 初始加載
    const initialFolderId = parseInt(window.location.pathname.split('/folder/')[1] || '1', 10);
    loadFolderContents(initialFolderId);
});
