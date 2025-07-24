// limkon/telegram-file-manager/telegram-file-manager-df63cbcbc7a99b98d3f81cc263302592a9f7d5ed/public/manager.js
document.addEventListener('DOMContentLoaded', () => {
    const fileGrid = document.getElementById('fileGrid');
    const searchInput = document.getElementById('searchInput');
    const categoriesContainer = document.getElementById('categories');
    const previewModal = document.getElementById('previewModal');
    const modalContent = document.getElementById('modalContent');
    const closeModal = document.querySelector('.close-button');
    const actionBar = document.getElementById('actionBar');
    const selectionCountSpan = document.getElementById('selectionCount');
    const previewBtn = document.getElementById('previewBtn');
    const renameBtn = document.getElementById('renameBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const deleteBtn = document.getElementById('deleteBtn');
    const selectAllBtn = document.getElementById('selectAllBtn');
    
    // --- 新增分享相关元素 ---
    const shareBtn = document.getElementById('shareBtn');
    const shareModal = document.getElementById('shareModal');
    const shareModalTitle = document.getElementById('shareModalTitle');
    const shareOptions = document.getElementById('shareOptions');
    const shareResult = document.getElementById('shareResult');
    const expiresInSelect = document.getElementById('expiresInSelect');
    const confirmShareBtn = document.getElementById('confirmShareBtn');
    const cancelShareBtn = document.getElementById('cancelShareBtn');
    const shareLinkContainer = document.getElementById('shareLinkContainer');
    const copyLinkBtn = document.getElementById('copyLinkBtn');
    const closeShareModalBtn = document.getElementById('closeShareModalBtn');


    let allFiles = [];
    let selectedFiles = new Set();
    let currentVisibleFiles = [];

    const getFileCategory = (mimetype) => {
        if (!mimetype) return 'other';
        if (mimetype.startsWith('image/')) return 'image';
        if (mimetype.startsWith('video/')) return 'video';
        if (mimetype.startsWith('audio/')) return 'audio';
        if (mimetype.startsWith('text/') || mimetype === 'application/json' || mimetype === 'application/xml') return 'document';
        if (mimetype.startsWith('application/pdf') || mimetype.includes('document')) return 'document';
        if (mimetype.startsWith('application/zip') || mimetype.startsWith('application/x-rar-compressed') || mimetype.includes('archive')) return 'archive';
        return 'other';
    };

    const getFileIcon = (file) => {
        if (file.thumb_file_id) {
            return `<img src="/thumbnail/${file.message_id}" alt="縮略圖" loading="lazy">`;
        }
        const category = getFileCategory(file.mimetype);
        const icons = { image: 'fa-file-image', video: 'fa-file-video', audio: 'fa-file-audio', document: 'fa-file-alt', archive: 'fa-file-archive', other: 'fa-file' };
        return `<i class="fas ${icons[category] || icons.other}"></i>`;
    };

    const updateActionBar = () => {
        const count = selectedFiles.size;
        
        if (count === 1) {
            const singleFileId = selectedFiles.values().next().value;
            const file = allFiles.find(f => f.message_id === singleFileId);
            selectionCountSpan.textContent = file ? `已選擇: ${file.fileName}` : '已選擇 1 個文件';
            selectionCountSpan.title = file ? file.fileName : '';
        } else {
            selectionCountSpan.textContent = `已選擇 ${count} 個文件`;
            selectionCountSpan.title = '';
        }
        
        const canPreview = count === 1 && ['image', 'video', 'audio', 'document'].includes(getFileCategory(allFiles.find(f => f.message_id === selectedFiles.values().next().value)?.mimetype));
        if(previewBtn) previewBtn.disabled = !canPreview;
        if(renameBtn) renameBtn.disabled = count !== 1;
        // --- 控制分享按钮状态 ---
        if(shareBtn) shareBtn.disabled = count !== 1;
        if(downloadBtn) downloadBtn.disabled = count === 0;
        if(deleteBtn) deleteBtn.disabled = count === 0;

        if (count > 0) {
            actionBar.classList.add('visible');
        } else {
            actionBar.classList.remove('visible');
        }

        if (currentVisibleFiles.length > 0 && count === currentVisibleFiles.length) {
            selectAllBtn.innerHTML = '<i class="fas fa-times"></i>';
            selectAllBtn.title = '取消全選';
        } else {
            selectAllBtn.innerHTML = '<i class="fas fa-check-double"></i>';
            selectAllBtn.title = '全選可見文件';
        }
    };

    const renderFiles = (filesToRender) => {
        currentVisibleFiles = filesToRender;
        fileGrid.innerHTML = '';
        if (filesToRender.length === 0) {
            fileGrid.innerHTML = '<p style="grid-column: 1 / -1; text-align: center;">沒有找到符合條件的文件。</p>';
            updateActionBar();
            return;
        }

        filesToRender.forEach(file => {
            const card = document.createElement('div');
            card.className = 'file-card';
            card.dataset.messageId = file.message_id;
            if (selectedFiles.has(file.message_id)) {
                card.classList.add('selected');
            }
            card.innerHTML = `
                <div class="file-icon">${getFileIcon(file)}</div>
                <div class="file-info">
                    <h5 title="${file.fileName}">${file.fileName}</h5>
                    <p>${new Date(file.date).toLocaleString()}</p>
                </div>
            `;
            fileGrid.appendChild(card);
        });
        updateActionBar();
    };
    
    const filterAndRender = () => {
        const searchTerm = searchInput.value.toLowerCase();
        const activeCategory = categoriesContainer.querySelector('.active').dataset.category;
        const filtered = allFiles.filter(file => 
            (activeCategory === 'all' || getFileCategory(file.mimetype) === activeCategory) &&
            file.fileName.toLowerCase().includes(searchTerm)
        );
        renderFiles(filtered);
    };

    async function loadFiles() {
        try {
            const res = await axios.get('/files');
            allFiles = res.data.sort((a, b) => b.date - a.date);
            
            const existingSelected = new Set();
            allFiles.forEach(file => {
                if(selectedFiles.has(file.message_id)) {
                    existingSelected.add(file.message_id);
                }
            });
            selectedFiles = existingSelected;
            
            filterAndRender();
        } catch (error) {
            fileGrid.innerHTML = '<p>加載文件失敗，請稍後重試。</p>';
        }
    }

    // --- 事件監聽 ---
    if(searchInput) { searchInput.addEventListener('input', filterAndRender); }
    if(categoriesContainer) {
        categoriesContainer.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') {
                categoriesContainer.querySelector('.active').classList.remove('active');
                e.target.classList.add('active');
                filterAndRender();
            }
        });
    }
    if(fileGrid) {
        fileGrid.addEventListener('click', (e) => {
            const card = e.target.closest('.file-card');
            if (!card) return;
            const messageId = parseInt(card.dataset.messageId, 10);
            
            card.classList.toggle('selected');
            if (selectedFiles.has(messageId)) {
                selectedFiles.delete(messageId);
            } else {
                selectedFiles.add(messageId);
            }
            updateActionBar();
        });
    }
    if(selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            const allVisibleIds = currentVisibleFiles.map(f => f.message_id);
            const allCurrentlySelected = allVisibleIds.length > 0 && allVisibleIds.every(id => selectedFiles.has(id));

            if (allCurrentlySelected) {
                allVisibleIds.forEach(id => selectedFiles.delete(id));
            } else {
                allVisibleIds.forEach(id => selectedFiles.add(id));
            }
            renderFiles(currentVisibleFiles);
        });
    }
    
    if(previewBtn) {
        previewBtn.addEventListener('click', async () => {
            if (previewBtn.disabled) return;
            
            const messageId = selectedFiles.values().next().value;
            const file = allFiles.find(f => f.message_id === messageId);
            if (!file) return;

            previewModal.style.display = 'flex';
            modalContent.innerHTML = '正在加載預覽...';
            
            const category = getFileCategory(file.mimetype);

            try {
                if (category === 'image' || category === 'video' || category === 'audio') {
                    const url = `/download/proxy/${messageId}`;
                    if (category === 'image') {
                        modalContent.innerHTML = `<img src="${url}" alt="預覽">`;
                    } else if (category === 'video') {
                        modalContent.innerHTML = `<video controls autoplay src="${url}"></video>`;
                    } else if (category === 'audio') {
                        modalContent.innerHTML = `<audio controls autoplay src="${url}"></audio>`;
                    }
                } else if (category === 'document' && (file.mimetype.startsWith('text/') || ['application/json', 'application/xml'].includes(file.mimetype))) {
                    const res = await axios.get(`/file/content/${messageId}`);
                    modalContent.innerHTML = `<pre>${escapeHtml(res.data)}</pre>`;
                } else {
                     modalContent.innerHTML = `此文件類型 (${file.mimetype}) 不支持直接預覽，請下載後查看。`;
                }
            } catch (error) {
                modalContent.innerHTML = '預覽失敗，此文件可能不支持或已損壞。';
            }
        });
    }
    
    function escapeHtml(unsafe) {
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    if(renameBtn) {
        renameBtn.addEventListener('click', async () => {
            if (renameBtn.disabled) return;
            const messageId = selectedFiles.values().next().value;
            const file = allFiles.find(f => f.message_id === messageId);
            const newFileName = prompt('請輸入新的文件名:', file.fileName);

            if (newFileName && newFileName.trim() !== '' && newFileName !== file.fileName) {
                try {
                    const res = await axios.post('/rename', { messageId, newFileName: newFileName.trim() });
                    if (res.data.success) {
                        selectedFiles.clear();
                        await loadFiles();
                    } else { alert('重命名失敗: ' + (res.data.message || '未知錯誤')); }
                } catch (error) { alert('重命名請求失敗'); }
            }
        });
    }

    if(deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
           if (deleteBtn.disabled) return;
            if (confirm(`確定要永久删除這 ${selectedFiles.size} 個文件嗎？`)) {
                try {
                    const res = await axios.post('/delete-multiple', { messageIds: Array.from(selectedFiles) });
                    alert(`成功删除 ${res.data.success.length} 個文件。`);
                    selectedFiles.clear();
                    await loadFiles();

                } catch (error) { alert('刪除請求失敗'); }
            }
        });
    }
    
    if(downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            if (downloadBtn.disabled) return;
            selectedFiles.forEach(messageId => {
                window.location.href = `/download/proxy/${messageId}`;
            });
        });
    }
    
    if(closeModal) {
        closeModal.onclick = () => {
            previewModal.style.display = 'none';
            modalContent.innerHTML = '';
        };
    }
    
    // --- 新增分享模态框逻辑 ---
    
    function showShareModal() {
        shareOptions.style.display = 'block';
        shareResult.style.display = 'none';
        shareLinkContainer.textContent = '';
        confirmShareBtn.disabled = false;
        confirmShareBtn.textContent = '生成分享鏈接';
        
        const messageId = selectedFiles.values().next().value;
        const file = allFiles.find(f => f.message_id === messageId);
        shareModalTitle.textContent = `分享文件: ${file.fileName}`;
        
        shareModal.style.display = 'flex';
    }

    function hideShareModal() {
        shareModal.style.display = 'none';
    }

    if (shareBtn) {
        shareBtn.addEventListener('click', () => {
            if (shareBtn.disabled) return;
            showShareModal();
        });
    }

    if (cancelShareBtn) cancelShareBtn.addEventListener('click', hideShareModal);
    if (closeShareModalBtn) closeShareModalBtn.addEventListener('click', hideShareModal);

    if (confirmShareBtn) {
        confirmShareBtn.addEventListener('click', async () => {
            confirmShareBtn.disabled = true;
            confirmShareBtn.textContent = '正在生成...';

            const messageId = selectedFiles.values().next().value;
            const expiresIn = expiresInSelect.value;
            
            try {
                const res = await axios.post('/share', { messageId, expiresIn });
                if (res.data.success) {
                    shareLinkContainer.textContent = res.data.url;
                    shareOptions.style.display = 'none';
                    shareResult.style.display = 'block';
                } else {
                    alert('創建分享鏈接失敗: ' + res.data.message);
                    hideShareModal();
                }
            } catch (error) {
                alert('創建分享鏈接請求失敗');
                hideShareModal();
            }
        });
    }
    
    if (copyLinkBtn) {
        copyLinkBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(shareLinkContainer.textContent).then(() => {
                copyLinkBtn.textContent = '已複製!';
                setTimeout(() => { copyLinkBtn.textContent = '複製鏈接'; }, 2000);
            }, () => {
                alert('複製失敗');
            });
        });
    }

    loadFiles();
});
