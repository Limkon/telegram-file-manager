document.addEventListener('DOMContentLoaded', async () => {
    const fileInput = document.getElementById('fileInput');
    const fileListContainer = document.getElementById('file-selection-list');
    const folderSelect = document.getElementById('folderSelect');
    const uploadForm = document.getElementById('uploadForm');

    const MAX_SERVER_SIZE = 1000 * 1024 * 1024; // 1 GB
    const MAX_TELEGRAM_SIZE = 50 * 1024 * 1024; // 50 MB

    // --- *** 關鍵修正 1：新增一個輔助函式來格式化檔案大小 *** ---
    const formatBytes = (bytes, decimals = 2) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    };

    const loadFolders = async () => {
        try {
            const res = await axios.get('/api/folders');
            const folders = res.data;
            const folderMap = new Map(folders.map(f => [f.id, { ...f, children: [] }]));
            
            const tree = [];
            folderMap.forEach(folder => {
                if (folder.parent_id && folderMap.has(folder.parent_id)) {
                    folderMap.get(folder.parent_id).children.push(folder);
                } else {
                    tree.push(folder);
                }
            });

            const buildOptions = (node, prefix = '') => {
                if (node.id === 1) {
                    node.children.forEach(child => buildOptions(child, ''));
                    return;
                }
                const option = document.createElement('option');
                option.value = node.id;
                option.textContent = prefix + '└ ' + node.name;
                folderSelect.appendChild(option);

                if (node.children.length > 0) {
                    node.children.forEach(child => buildOptions(child, prefix + '　'));
                }
            };
            
            tree.forEach(rootNode => buildOptions(rootNode));

        } catch (error) {
            console.error('加載資料夾列表失敗', error);
        }
    };
    
    if (folderSelect) {
        await loadFolders();
    }

    if (fileInput) {
        fileInput.addEventListener('change', () => {
            fileListContainer.innerHTML = '';
            if (fileInput.files.length > 0) {
                for (const file of fileInput.files) {
                    const listItem = document.createElement('li');
                    const fileSize = (file.size / 1024 / 1024).toFixed(2);
                    listItem.innerHTML = `<span>${file.name}</span><small>${fileSize} MB</small>`;
                    fileListContainer.appendChild(listItem);
                }
            }
        });
    }

    if (uploadForm) {
        uploadForm.onsubmit = async function (e) {
            e.preventDefault();
            
            if (fileInput.files.length === 0) {
                showNotification('請先選擇至少一個文件', 'error');
                return;
            }

            for (const file of fileInput.files) {
                // --- *** 關鍵修正 2：使用輔助函式來動態生成提示訊息 *** ---
                if (file.size > MAX_SERVER_SIZE) {
                    showNotification(`檔案 "${file.name}" 過大，超過伺服器 ${formatBytes(MAX_SERVER_SIZE)} 的限制。`, 'error');
                    return;
                }
                if (file.size > MAX_TELEGRAM_SIZE) {
                    showNotification(`檔案 "${file.name}" 過大，超過 Telegram ${formatBytes(MAX_TELEGRAM_SIZE)} 的限制。`, 'error');
                    return;
                }
            }
            
            const formData = new FormData();
            for (let i = 0; i < fileInput.files.length; i++) {
                formData.append('files', fileInput.files[i]);
            }
            
            const caption = e.target.querySelector('input[name="caption"]').value;
            const folderId = folderSelect.value;
            if (caption) formData.append('caption', caption);
            if (folderId) formData.append('folderId', folderId);

            const submitButton = e.target.querySelector('button[type="submit"]');
            const progressArea = document.getElementById('progressArea');
            const progressBar = document.getElementById('progressBar');

            submitButton.disabled = true;
            submitButton.textContent = '上傳中...';
            progressArea.style.display = 'block';
            progressBar.style.width = '0%';
            progressBar.textContent = '0%';

            const config = {
                onUploadProgress: function(progressEvent) {
                if (progressEvent.total) {
                    const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                    progressBar.style.width = percentCompleted + '%';
                    progressBar.textContent = percentCompleted + '%';
                }
                }
            };

            try {
                const res = await axios.post('/upload', formData, config);
                if (res.data.success) {
                    const failedUploads = res.data.results.filter(r => !r.success);
                    if (failedUploads.length > 0) {
                        const firstError = failedUploads[0].error?.description || '未知錯誤';
                        showNotification(`有 ${failedUploads.length} 個文件上傳失敗。錯誤: ${firstError}`, 'error');
                    } else {
                        showNotification('所有文件上傳成功！', 'success');
                    }
                    e.target.reset();
                    fileListContainer.innerHTML = '';
                } else {
                    showNotification(res.data.message || '上傳請求失敗', 'error');
                }
            } catch (error) {
                const errorMessage = error.response?.data?.message || '網絡或服務器錯誤';
                showNotification(`上傳失敗: ${errorMessage}`, 'error');
            } finally {
                submitButton.disabled = false;
                submitButton.textContent = '上傳';
                setTimeout(() => { progressArea.style.display = 'none'; }, 2000);
            }
        };
    }

    function showNotification(message, type = 'info') {
        const existingNotif = document.querySelector('.notification');
        if (existingNotif) { existingNotif.remove(); }
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => {
            if (notification.parentElement) {
              notification.parentElement.removeChild(notification);
            }
        }, 5000);
    }
});
