document.addEventListener('DOMContentLoaded', () => {
    // DOM 元素
    const homeLink = document.getElementById('homeLink');
    const itemGrid = document.getElementById('itemGrid');
    const breadcrumb = document.getElementById('breadcrumb');
    const actionBar = document.getElementById('actionBar');
    const selectionCountSpan = document.getElementById('selectionCount');
    const createFolderBtn = document.getElementById('createFolderBtn');
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
    const textEditBtn = document.getElementById('textEditBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    const previewModal = document.getElementById('previewModal');
    const modalContent = document.getElementById('modalContent');
    const closeModal = document.querySelector('.close-button');
    const moveModal = document.getElementById('moveModal');
    const folderTree = document.getElementById('folderTree');
    const confirmMoveBtn = document.getElementById('confirmMoveBtn');
    const cancelMoveBtn = document.getElementById('cancelMoveBtn');
    const conflictModal = document.getElementById('conflictModal');
    const conflictFileName = document.getElementById('conflictFileName');
    const conflictOptions = document.getElementById('conflictOptions');
    const shareModal = document.getElementById('shareModal');
    const uploadModal = document.getElementById('uploadModal');
    const showUploadModalBtn = document.getElementById('showUploadModalBtn');
    const closeUploadModalBtn = document.getElementById('closeUploadModalBtn');
    const uploadForm = document.getElementById('uploadForm');
    const fileInput = document.getElementById('fileInput');
    const folderInput = document.getElementById('folderInput');
    const uploadSubmitBtn = document.getElementById('uploadSubmitBtn');
    const fileListContainer = document.getElementById('file-selection-list');
    const folderSelect = document.getElementById('folderSelect');
    const uploadNotificationArea = document.getElementById('uploadNotificationArea');
    const dropZone = document.getElementById('dropZone');
    const dragUploadProgressArea = document.getElementById('dragUploadProgressArea');
    const dragUploadProgressBar = document.getElementById('dragUploadProgressBar');
    const viewSwitchBtn = document.getElementById('view-switch-btn');
    const itemListView = document.getElementById('itemListView');
    const itemListBody = document.getElementById('itemListBody');

    // 状态
    let isMultiSelectMode = false;
    let currentFolderId = 1;
    let currentFolderContents = { folders: [], files: [] };
    let selectedItems = new Map();
    let moveTargetFolderId = null;
    let isSearchMode = false;
    const MAX_TELEGRAM_SIZE = 50 * 1024 * 1024;
    let foldersLoaded = false;
    let currentView = 'grid'; // 'grid' or 'list'

    // --- 辅助函式 ---
    const formatBytes = (bytes, decimals = 2) => {
        if (!bytes || bytes === 0) return '0 Bytes';
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
            // 不再显示“正在加载”，以避免闪烁
            // itemGrid.innerHTML = '<p>正在加载...</p>';
            // itemListBody.innerHTML = '<p>正在加载...</p>';
            currentFolderId = folderId;
            const res = await axios.get(`/api/folder/${folderId}`);
            currentFolderContents = res.data.contents;
            // 清理已不存在的选择项
            const currentIds = new Set([...res.data.contents.folders.map(f => String(f.id)), ...res.data.contents.files.map(f => String(f.id))]);
            selectedItems.forEach((_, key) => {
                if (!currentIds.has(key)) {
                    selectedItems.delete(key);
                }
            });
            renderBreadcrumb(res.data.path);
            renderItems(currentFolderContents.folders, currentFolderContents.files);
            updateActionBar();
        } catch (error) {
            if (error.response && error.response.status === 401) {
                window.location.href = '/login';
            }
            itemGrid.innerHTML = '<p>加载内容失败。</p>';
            itemListBody.innerHTML = '<p>加载内容失败。</p>';
        }
    };
    const executeSearch = async (query) => {
        try {
            isSearchMode = true;
            // 不再显示“正在加载”，以避免闪烁
            // itemGrid.innerHTML = '<p>正在搜寻...</p>';
            // itemListBody.innerHTML = '<p>正在搜寻...</p>';
            const res = await axios.get(`/api/search?q=${encodeURIComponent(query)}`);
            currentFolderContents = res.data.contents;
            selectedItems.clear();
            renderBreadcrumb(res.data.path);
            renderItems(currentFolderContents.folders, currentFolderContents.files);
            updateActionBar();
        } catch (error) {
            itemGrid.innerHTML = '<p>搜寻失败。</p>';
            itemListBody.innerHTML = '<p>搜寻失败。</p>';
        }
    };
    const renderBreadcrumb = (path) => {
        breadcrumb.innerHTML = '';
        if(!path || path.length === 0) return;
        path.forEach((p, index) => {
            if (index > 0) breadcrumb.innerHTML += '<span class="separator">/</span>';
            if (p.id === null) {
                breadcrumb.innerHTML += `<span>${p.name}</span>`;
                return;
            }
            const link = document.createElement(index === path.length - 1 && !isSearchMode ? 'span' : 'a');
            link.textContent = p.name === '/' ? '根目录' : p.name;
            if (link.tagName === 'A') {
                link.href = '#';
                link.dataset.folderId = p.id;
            }
            breadcrumb.appendChild(link);
        });
    };
    
    // --- *** 关键修正 开始 (防闪烁渲染) *** ---
    const renderItems = (folders, files) => {
        const parentGrid = itemGrid;
        const parentList = itemListBody;

        const allNewItems = [...folders, ...files];
        const newIdSet = new Set(allNewItems.map(item => String(item.id)));
        
        let existingGridElements = new Map();
        parentGrid.querySelectorAll('.item-card').forEach(el => existingGridElements.set(el.dataset.id, el));

        let existingListElements = new Map();
        parentList.querySelectorAll('.list-item').forEach(el => existingListElements.set(el.dataset.id, el));

        // 更新或添加项目
        allNewItems.forEach(item => {
            const itemIdStr = String(item.id);

            // 更新或添加网格视图项目
            if (existingGridElements.has(itemIdStr)) {
                const el = existingGridElements.get(itemIdStr);
                const oldName = el.querySelector('h5').textContent;
                if (oldName !== (item.name === '/' ? '根目录' : item.name)) {
                    el.querySelector('h5').textContent = item.name;
                    el.querySelector('h5').title = item.name;
                }
                el.classList.toggle('selected', selectedItems.has(itemIdStr));
            } else {
                parentGrid.appendChild(createItemCard(item));
            }

            // 更新或添加列表视图项目
            if (existingListElements.has(itemIdStr)) {
                const el = existingListElements.get(itemIdStr);
                const oldName = el.querySelector('.list-name').textContent;
                if (oldName !== (item.name === '/' ? '根目录' : item.name)) {
                    el.querySelector('.list-name').textContent = item.name;
                    el.querySelector('.list-name').title = item.name;
                }
                if (item.type === 'file') {
                    el.querySelector('.list-size').textContent = formatBytes(item.size);
                    el.querySelector('.list-date').textContent = new Date(item.date).toLocaleDateString();
                }
                 el.classList.toggle('selected', selectedItems.has(itemIdStr));
            } else {
                parentList.appendChild(createListItem(item));
            }
        });

        // 移除不存在的项目
        existingGridElements.forEach((el, id) => {
            if (!newIdSet.has(id)) {
                el.remove();
            }
        });
        existingListElements.forEach((el, id) => {
            if (!newIdSet.has(id)) {
                el.remove();
            }
        });

        // 处理空文件夹提示
        if (allNewItems.length === 0) {
            if(currentView === 'grid') parentGrid.innerHTML = isSearchMode ? '<p>找不到符合条件的档案。</p>' : '<p>这个资料夹是空的。</p>';
            else parentList.innerHTML = isSearchMode ? '<div class="list-item"><p>找不到符合条件的档案。</p></div>' : '<div class="list-item"><p>这个资料夹是空的。</p></div>';
        } else {
            const emptyGridMsg = parentGrid.querySelector('p');
            if(emptyGridMsg) emptyGridMsg.remove();
            const emptyListMsg = parentList.querySelector('.list-item p');
            if(emptyListMsg) emptyListMsg.parentElement.remove();
        }
    };
    // --- *** 关键修正 结束 *** ---

    const createItemCard = (item) => {
        const card = document.createElement('div');
        card.className = 'item-card';
        card.dataset.id = item.id;
        card.dataset.type = item.type;
        card.dataset.name = item.name === '/' ? '根目录' : item.name;

        let iconHtml = '';
        if (item.type === 'file') {
            const fullFile = currentFolderContents.files.find(f => f.id === item.id) || item;
            if (fullFile.storage_type === 'telegram' && fullFile.thumb_file_id) {
                iconHtml = `<img src="/thumbnail/${item.id}" alt="缩图" loading="lazy">`;
            } else if (fullFile.mimetype && fullFile.mimetype.startsWith('image/')) {
                 iconHtml = `<img src="/download/proxy/${item.id}" alt="图片" loading="lazy">`;
            } else if (fullFile.mimetype && fullFile.mimetype.startsWith('video/')) {
                iconHtml = `<video src="/download/proxy/${item.id}#t=0.1" preload="metadata" muted></video>`;
            } else {
                 iconHtml = `<i class="fas ${getFileIconClass(item.mimetype)}"></i>`;
            }
        } else { // folder
            iconHtml = '<i class="fas fa-folder"></i>';
        }

        card.innerHTML = `<div class="item-icon">${iconHtml}</div><div class="item-info"><h5 title="${item.name}">${item.name === '/' ? '根目录' : item.name}</h5></div>`;
        if (selectedItems.has(String(item.id))) card.classList.add('selected');
        return card;
    };

    const createListItem = (item) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'list-item';
        itemDiv.dataset.id = item.id;
        itemDiv.dataset.type = item.type;
        itemDiv.dataset.name = item.name === '/' ? '根目录' : item.name;

        const icon = item.type === 'folder' ? 'fa-folder' : getFileIconClass(item.mimetype);
        const name = item.name === '/' ? '根目录' : item.name;
        const size = item.type === 'file' && item.size ? formatBytes(item.size) : '—';
        const date = item.date ? new Date(item.date).toLocaleDateString() : '—';

        itemDiv.innerHTML = `
            <div class="list-icon"><i class="fas ${icon}"></i></div>
            <div class="list-name" title="${name}">${name}</div>
            <div class="list-size">${size}</div>
            <div class="list-date">${date}</div>
        `;

        if (selectedItems.has(String(item.id))) {
            itemDiv.classList.add('selected');
        }

        return itemDiv;
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
        selectionCountSpan.textContent = `已选择 ${count} 个项目`;

        if (downloadBtn) downloadBtn.disabled = count === 0;

        const isSingleTextFile = count === 1 && selectedItems.values().next().value.name.endsWith('.txt');
        if (textEditBtn) {
            textEditBtn.disabled = !(count === 0 || isSingleTextFile);
            textEditBtn.innerHTML = count === 0 ? '<i class="fas fa-file-alt"></i>' : '<i class="fas fa-edit"></i>';
            textEditBtn.title = count === 0 ? '新建文字档' : '编辑文字档';
        }

        if (previewBtn) previewBtn.disabled = count !== 1 || (count === 1 && selectedItems.values().next().value.type === 'folder');

        if (shareBtn) shareBtn.disabled = count !== 1;

        if (renameBtn) renameBtn.disabled = count !== 1;
        if (moveBtn) moveBtn.disabled = count === 0 || isSearchMode;
        if (deleteBtn) deleteBtn.disabled = count === 0;

        actionBar.classList.toggle('visible', true);

        if (!isMultiSelectMode && multiSelectBtn) {
            multiSelectBtn.classList.remove('active');
        }
    };
    const rerenderSelection = () => {
        document.querySelectorAll('.item-card, .list-item').forEach(el => {
            el.classList.toggle('selected', selectedItems.has(el.dataset.id));
        });
    };
    const loadFoldersForSelect = async () => {
        // --- *** 关键修正: 增加强制刷新选项 *** ---
        if (foldersLoaded) return;
        try {
            const res = await axios.get('/api/folders');
            const folders = res.data;
            const folderMap = new Map(folders.map(f => [f.id, { ...f, children: [] }]));
            const tree = [];
            folderMap.forEach(f => {
                if (f.parent_id && folderMap.has(f.parent_id)) folderMap.get(f.parent_id).children.push(f);
                else tree.push(f);
            });

            folderSelect.innerHTML = '';
            const buildOptions = (node, prefix = '') => {
                const option = document.createElement('option');
                option.value = node.id;
                option.textContent = prefix + (node.name === '/' ? '根目录' : node.name);
                folderSelect.appendChild(option);
                node.children.sort((a,b) => a.name.localeCompare(b.name)).forEach(child => buildOptions(child, prefix + '　'));
            };
            tree.sort((a,b) => a.name.localeCompare(b.name)).forEach(buildOptions);

            foldersLoaded = true;
        } catch (error) {
            console.error('加载资料夹列表失败', error);
        }
    };
    const uploadFiles = async (files, targetFolderId, isDrag = false) => {
        if (files.length === 0) return;

        const oversizedFiles = Array.from(files).filter(file => file.size > MAX_TELEGRAM_SIZE);
        if (oversizedFiles.length > 0) {
            const fileNames = oversizedFiles.map(f => `"${f.name}"`).join(', ');
            showNotification(`档案 ${fileNames} 过大，超过 ${formatBytes(MAX_TELEGRAM_SIZE)} 的限制。`, 'error', !isDrag ? uploadNotificationArea : null);
            return;
        }

        let existenceData = [];
        try {
            const res = await axios.post('/api/check-existence', { fileNames: Array.from(files).map(f => f.name), folderId: targetFolderId });
            existenceData = res.data.files;
        } catch (error) {
            showNotification('检查档案是否存在时出错。', 'error');
            return;
        }

        const filesToUpload = [];
        const filesToOverwrite = [];

        for (const file of Array.from(files)) {
            const existing = existenceData.find(f => f.name === file.name && f.exists);
            if (existing) {
                if (confirm(`档案 "${file.name}" 已存在。您要覆盖它吗？`)) {
                    filesToOverwrite.push({ name: file.name, messageId: existing.messageId });
                    filesToUpload.push(file);
                }
            } else {
                filesToUpload.push(file);
            }
        }

        if (filesToUpload.length === 0) {
            showNotification('已取消，没有档案被上传。', 'info');
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

        progressArea.style.display = 'block';
        progressBar.style.width = '0%';
        progressBar.textContent = '0%';

        if(uploadSubmitBtn) uploadSubmitBtn.disabled = true;

        try {
            const res = await axios.post('/upload', formData, {
                onUploadProgress: p => {
                    const percent = Math.round((p.loaded * 100) / p.total);
                    progressBar.style.width = percent + '%';
                    progressBar.textContent = percent + '%';
                }
            });
            if (res.data.success) {
                if (!isDrag) {
                    uploadModal.style.display = 'none';
                }
                showNotification('上传成功！', 'success');
                loadFolderContents(currentFolderId);
            } else {
                showNotification('上传失败', 'error', !isDrag ? uploadNotificationArea : null);
            }
        } catch (error) {
            showNotification('上传失败: ' + (error.response?.data?.message || '伺服器错误'), 'error', !isDrag ? uploadNotificationArea : null);
        } finally {
            if(uploadSubmitBtn) uploadSubmitBtn.disabled = false;
            setTimeout(() => { progressArea.style.display = 'none'; }, 2000);
        }
    };

    const switchView = (view) => {
        if (view === 'grid') {
            itemGrid.style.display = 'grid';
            itemListView.style.display = 'none';
            viewSwitchBtn.innerHTML = '<i class="fas fa-list"></i>';
            currentView = 'grid';
        } else {
            itemGrid.style.display = 'none';
            itemListView.style.display = 'block';
            viewSwitchBtn.innerHTML = '<i class="fas fa-th"></i>';
            currentView = 'list';
        }
        renderItems(currentFolderContents.folders, currentFolderContents.files);
    };

    // --- 事件监听 ---
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            window.location.href = '/logout';
        });
    }

    if (changePasswordBtn) {
        changePasswordBtn.addEventListener('click', async () => {
            const oldPassword = prompt('请输入您的旧密码：');
            if (!oldPassword) return;

            const newPassword = prompt('请输入您的新密码 (至少 4 个字元)：');
            if (!newPassword) return;

            if (newPassword.length < 4) {
                alert('密码长度至少需要 4 个字元。');
                return;
            }

            const confirmPassword = prompt('请再次输入新密码以确认：');
            if (newPassword !== confirmPassword) {
                alert('两次输入的密码不一致！');
                return;
            }

            try {
                const res = await axios.post('/api/user/change-password', { oldPassword, newPassword });
                if (res.data.success) {
                    alert('密码修改成功！');
                }
            } catch (error) {
                alert('密码修改失败：' + (error.response?.data?.message || '伺服器错误'));
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', () => {
            fileListContainer.innerHTML = '';
            if (fileInput.files.length > 0) {
                for (const file of fileInput.files) {
                    const li = document.createElement('li');
                    li.textContent = file.name;
                    fileListContainer.appendChild(li);
                }
                uploadSubmitBtn.style.display = 'block';
            }
        });
    }

    if(folderInput) {
        folderInput.addEventListener('change', (e) => {
            const files = e.target.files;
            if (files.length > 0) {
                const folderName = files[0].webkitRelativePath.split('/')[0];
                fileListContainer.innerHTML = `<li>已选择资料夹: <b>${folderName}</b> (包含 ${files.length} 个档案)</li>`;
                uploadSubmitBtn.style.display = 'block';
            }
        });
    }

    async function handleFolderUpload(files, folderName) {
        const parentId = folderSelect.value;
        try {
            const res = await axios.post('/api/folder', { name: folderName, parentId });
            const targetFolderId = res.data.id;
            
            // --- *** 关键修正: 更新目录列表 *** ---
            foldersLoaded = false; 

            await uploadFiles(Array.from(files), targetFolderId, false);

        } catch (error) {
            showNotification('处理资料夾上传失败：' + (error.response?.data?.message || '伺服器错误'), 'error', uploadNotificationArea);
        }
    }

    if (uploadForm) {
        uploadForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const files = fileInput.files;
            const folderFiles = folderInput.files;

            if (folderFiles.length > 0) {
                const folderName = folderFiles[0].webkitRelativePath.split('/')[0];
                handleFolderUpload(folderFiles, folderName);
            } else if (files.length > 0) {
                const targetFolderId = folderSelect.value;
                uploadFiles(Array.from(files), targetFolderId, false);
            } else {
                showNotification('请选择档案或资料夹。', 'error', uploadNotificationArea);
            }
        });
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
            const files = Array.from(e.dataTransfer.files);
            let hasFolder = false;
            if (e.dataTransfer.items) {
                for(let i=0; i<e.dataTransfer.items.length; i++) {
                    const item = e.dataTransfer.items[i];
                    if (typeof item.webkitGetAsEntry === "function" && item.webkitGetAsEntry().isDirectory) {
                        hasFolder = true;
                        break;
                    }
                }
            }

            if (hasFolder) {
                showNotification('不支援拖拽资料夹上传，请选择档案。', 'error');
                return;
            }

            if (files.length > 0) {
                uploadFiles(files, currentFolderId, true);
            }
        });
    }

    if (homeLink) {
        homeLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.history.pushState(null, '', '/');
            window.location.href = '/';
        });
    }
    const handleItemClick = (e) => {
        const target = e.target.closest('.item-card, .list-item');
        if (!target) return;
        const id = target.dataset.id;
        const type = target.dataset.type;
        const name = target.dataset.name;

        if (isMultiSelectMode) {
            if (selectedItems.has(id)) {
                selectedItems.delete(id);
            } else {
                selectedItems.set(id, { type, name });
            }
        } else {
            const isSelected = selectedItems.has(id);
            selectedItems.clear();
            if (!isSelected) {
                selectedItems.set(id, { type, name });
            }
        }
        rerenderSelection();
        updateActionBar();
    };

    const handleItemDblClick = (e) => {
        const target = e.target.closest('.item-card, .list-item');
        if (target && target.dataset.type === 'folder') {
            const folderId = parseInt(target.dataset.id, 10);
            window.history.pushState(null, '', `/folder/${folderId}`);
            loadFolderContents(folderId);
        }
    };
    
    if (itemGrid) {
        itemGrid.addEventListener('click', handleItemClick);
        itemGrid.addEventListener('dblclick', handleItemDblClick);
    }
    if (itemListBody) {
        itemListBody.addEventListener('click', handleItemClick);
        itemListBody.addEventListener('dblclick', handleItemDblClick);
    }
    
    if (viewSwitchBtn) {
        viewSwitchBtn.addEventListener('click', () => {
            switchView(currentView === 'grid' ? 'list' : 'grid');
        });
    }

    if (breadcrumb) {
        breadcrumb.addEventListener('click', e => {
            e.preventDefault();
            const link = e.target.closest('a');
            if (link && link.dataset.folderId) {
                const folderId = parseInt(link.dataset.folderId, 10);
                window.history.pushState(null, '', `/folder/${folderId}`);
                loadFolderContents(folderId);
            }
        });
    }
    window.addEventListener('popstate', () => {
        if (document.getElementById('itemGrid')) {
            const pathParts = window.location.pathname.split('/');
            // 使用 last item 来处理 /folder/1 和 /folder/1/ 的情况
            const lastPart = pathParts.filter(p => p).pop();
            let folderId = parseInt(lastPart, 10);
            if (isNaN(folderId)) {
                folderId = 1; // 默认为根目录
            }
            loadFolderContents(folderId);
        }
    });
    if (createFolderBtn) {
        createFolderBtn.addEventListener('click', async () => {
            const name = prompt('请输入新资料夹的名称：');
            if (name && name.trim()) {
                try {
                    await axios.post('/api/folder', { name: name.trim(), parentId: currentFolderId });
                    
                    // --- *** 关键修正: 更新目录列表 *** ---
                    foldersLoaded = false; 

                    loadFolderContents(currentFolderId);
                } catch (error) { alert(error.response?.data?.message || '建立失败'); }
            }
        });
    }
    if (searchForm) {
        searchForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const query = searchInput.value.trim();
            if (query) executeSearch(query);
            else if(isSearchMode) loadFolderContents(currentFolderId);
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
            await loadFoldersForSelect();
            folderSelect.value = currentFolderId;
            uploadNotificationArea.innerHTML = '';
            uploadForm.reset();
            fileListContainer.innerHTML = '';
            uploadSubmitBtn.style.display = 'block';
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
            const file = currentFolderContents.files.find(f => String(f.id) === messageId);
            if (!file) return;

            previewModal.style.display = 'flex';
            modalContent.innerHTML = '正在加载预览...';
            const downloadUrl = `/download/proxy/${messageId}`;

            if (file.mimetype && file.mimetype.startsWith('image/')) {
                modalContent.innerHTML = `<img src="${downloadUrl}" alt="图片预览">`;
            } else if (file.mimetype && file.mimetype.startsWith('video/')) {
                modalContent.innerHTML = `<video src="${downloadUrl}" controls autoplay></video>`;
            } else if (file.mimetype && (file.mimetype.startsWith('text/') || file.name.endsWith('.txt'))) {
                try {
                    const res = await axios.get(`/file/content/${messageId}`);
                    const escapedContent = res.data.replace(/&/g, "&amp;").replace(/</g, "&lt;");
                    modalContent.innerHTML = `<pre><code>${escapedContent}</code></pre>`;
                } catch {
                    modalContent.innerHTML = '无法载入文字内容。';
                }
            } else {
                modalContent.innerHTML = `
                    <div class="no-preview">
                        <i class="fas fa-file"></i>
                        <p>此档案类型不支持预览。</p>
                        <a href="${downloadUrl}" class="upload-link-btn" download>下载档案</a>
                    </div>
                `;
            }
        });
    }
    if (renameBtn) {
        renameBtn.addEventListener('click', async () => {
             if (renameBtn.disabled) return;
             const [id, item] = selectedItems.entries().next().value;
             const newName = prompt('请输入新的名称:', item.name);
             if (newName && newName.trim() && newName !== item.name) {
                 try {
                    await axios.post('/rename', {
                        id: id,
                        newName: newName.trim(),
                        type: item.type
                    });
                    loadFolderContents(currentFolderId);
                 } catch (error) {
                     alert('重命名失败: ' + (error.response?.data?.message || '伺服器错误'));
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
                alert('下载压缩档失败！');
            }
        });
    }
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            if (selectedItems.size === 0) return;
            if (!confirm(`确定要删除这 ${selectedItems.size} 个项目吗？\n注意：删除资料夹将会一并删除其所有内容！`)) return;
            const filesToDelete = [], foldersToDelete = [];
            selectedItems.forEach((item, id) => {
                if (item.type === 'file') filesToDelete.push(parseInt(id));
                else foldersToDelete.push(parseInt(id));
            });
            try {
                if (filesToDelete.length > 0) await axios.post('/delete-multiple', { messageIds: filesToDelete });
                for (const folderId of foldersToDelete) await axios.post('/api/folder/delete', { folderId });
                loadFolderContents(currentFolderId);
            } catch (error) { alert('删除失败，请重试。'); }
        });
    }

    if (moveBtn) {
        moveBtn.addEventListener('click', async () => {
            if (selectedItems.size === 0) return;
            try {
                const res = await axios.get('/api/folders');
                const folders = res.data;
                folderTree.innerHTML = '';

                const folderMap = new Map(folders.map(f => [f.id, { ...f, children: [] }]));
                const tree = [];
                folderMap.forEach(f => {
                    if (f.parent_id && folderMap.has(f.parent_id)) {
                        folderMap.get(f.parent_id).children.push(f);
                    } else {
                        tree.push(f);
                    }
                });

                const disabledFolderIds = new Set();
                selectedItems.forEach((item, id) => {
                    if (item.type === 'folder') {
                        const folderId = parseInt(id);
                        disabledFolderIds.add(folderId);
                        const findDescendants = (parentId) => {
                            const parentNode = folderMap.get(parentId);
                            if (parentNode && parentNode.children) {
                                parentNode.children.forEach(child => {
                                    disabledFolderIds.add(child.id);
                                    findDescendants(child.id);
                                });
                            }
                        };
                        findDescendants(folderId);
                    }
                });

                const buildTree = (node, prefix = '') => {
                    const isDisabled = disabledFolderIds.has(node.id) || node.id === currentFolderId;

                    const item = document.createElement('div');
                    item.className = 'folder-item';
                    item.dataset.folderId = node.id;
                    item.textContent = prefix + (node.name === '/' ? '根目录' : node.name);

                    if (isDisabled) {
                        item.style.color = '#ccc';
                        item.style.cursor = 'not-allowed';
                    }

                    folderTree.appendChild(item);
                    node.children.sort((a,b) => a.name.localeCompare(b.name)).forEach(child => buildTree(child, prefix + '　'));
                };
                tree.sort((a,b) => a.name.localeCompare(b.name)).forEach(node => buildTree(node));

                moveModal.style.display = 'flex';
                moveTargetFolderId = null;
                confirmMoveBtn.disabled = true;
            } catch { alert('无法获取资料夹列表。'); }
        });
    }
    if (folderTree) {
        folderTree.addEventListener('click', e => {
            const target = e.target.closest('.folder-item');
            if (!target || target.style.cursor === 'not-allowed') return;

            const previouslySelected = folderTree.querySelector('.folder-item.selected');
            if (previouslySelected) previouslySelected.classList.remove('selected');
            target.classList.add('selected');
            moveTargetFolderId = parseInt(target.dataset.folderId);
            confirmMoveBtn.disabled = false;
        });
    }

    async function handleConflict(conflicts) {
        let overwriteList = [];
        let i = 0;

        function showNextConflict() {
            return new Promise((resolve) => {
                if (i >= conflicts.length) {
                    resolve({ action: 'finish', overwriteList });
                    return;
                }

                conflictFileName.textContent = conflicts[i];
                conflictModal.style.display = 'flex';

                conflictOptions.onclick = (e) => {
                    const action = e.target.dataset.action;
                    if (!action) return;

                    conflictModal.style.display = 'none';
                    if (action === 'overwrite') {
                        overwriteList.push(conflicts[i]);
                        i++;
                        resolve(showNextConflict());
                    } else if (action === 'overwrite_all') {
                        overwriteList = conflicts;
                        resolve({ action: 'finish', overwriteList });
                    } else if (action === 'skip') {
                        i++;
                        resolve(showNextConflict());
                    } else if (action === 'skip_all') {
                        resolve({ action: 'finish', overwriteList: [] });
                    } else if (action === 'abort') {
                        resolve({ action: 'abort' });
                    }
                };
            });
        }
        return showNextConflict();
    }

    if (confirmMoveBtn) {
        confirmMoveBtn.addEventListener('click', async () => {
            if (!moveTargetFolderId) return;

            const itemIds = Array.from(selectedItems.keys()).map(id => parseInt(id, 10));
            const fileIds = [];
            
            selectedItems.forEach((item, id) => {
                if(item.type === 'file') fileIds.push(parseInt(id, 10));
            });

            try {
                const conflictRes = await axios.post('/api/check-move-conflict', {
                    itemIds: fileIds,
                    targetFolderId: moveTargetFolderId
                });

                const conflicts = conflictRes.data.conflicts;
                let overwriteList = [];

                if (conflicts && conflicts.length > 0) {
                    const result = await handleConflict(conflicts);
                    if (result.action === 'abort') {
                        showNotification('移动操作已放弃。', 'info');
                        moveModal.style.display = 'none';
                        return;
                    }
                    overwriteList = result.overwriteList;
                }

                await axios.post('/api/move', {
                    itemIds,
                    targetFolderId: moveTargetFolderId,
                    overwriteList
                });
                moveModal.style.display = 'none';
                loadFolderContents(currentFolderId);
                showNotification('项目移动成功！', 'success');

            } catch (error) {
                alert('操作失败：' + (error.response?.data?.message || '伺服器错误'));
            }
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
            const [itemId, item] = selectedItems.entries().next().value;
            const itemType = item.type;
            const expiresIn = expiresInSelect.value;
            try {
                const res = await axios.post('/share', { itemId, itemType, expiresIn });
                if (res.data.success) {
                    shareLinkContainer.textContent = res.data.url;
                    shareOptions.style.display = 'none';
                    shareResult.style.display = 'block';
                } else {
                    alert('创建分享链接失败: ' + res.data.message);
                }
            } catch {
                alert('创建分享链接请求失败');
            }
        });
        copyLinkBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(shareLinkContainer.textContent).then(() => {
                copyLinkBtn.textContent = '已复制!';
                setTimeout(() => { copyLinkBtn.textContent = '复制链接'; }, 2000);
            });
        });
    }
    if (closeModal) closeModal.onclick = () => {
        previewModal.style.display = 'none';
        modalContent.innerHTML = '';
    };
    if (cancelMoveBtn) cancelMoveBtn.addEventListener('click', () => moveModal.style.display = 'none');

    if (textEditBtn) {
        textEditBtn.addEventListener('click', () => {
            if (textEditBtn.disabled) return;

            const selectionCount = selectedItems.size;
            if (selectionCount === 0) {
                window.open(`/editor?mode=create&folderId=${currentFolderId}`, '_blank');
            } else {
                const fileId = selectedItems.keys().next().value;
                window.open(`/editor?mode=edit&fileId=${fileId}`, '_blank');
            }
        });
    }

    window.addEventListener('message', (event) => {
        if (event.data === 'refresh-files') {
            loadFolderContents(currentFolderId);
        }
    });
    
    // 初始化页面
    if (document.getElementById('itemGrid')) {
        const pathParts = window.location.pathname.split('/');
        // 使用 last item 来处理 /folder/1 和 /folder/1/ 的情况
        const lastPart = pathParts.filter(p => p).pop();
        let folderId = parseInt(lastPart, 10);
        if (isNaN(folderId)) {
            folderId = 1; // 默认为根目录
        }
        loadFolderContents(folderId);
    }
});
