document.addEventListener('DOMContentLoaded', async () => {
    const fileInput = document.getElementById('fileInput');
    const fileListContainer = document.getElementById('file-selection-list');
    const folderSelect = document.getElementById('folderSelect');

    // --- 新增：加載資料夾列表 ---
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

            // 遞歸生成選項
            const buildOptions = (node, prefix = '') => {
                // 根目錄特殊處理
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
    
    await loadFolders();

    // --- 事件監聽 ---
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

    document.getElementById('uploadForm').onsubmit = async function (e) {
      e.preventDefault();
      
      const formData = new FormData();
      if (fileInput.files.length === 0) {
        showNotification('請先選擇至少一個文件', 'error');
        return;
      }
      for (let i = 0; i < fileInput.files.length; i++) {
        formData.append('files', fileInput.files[i]);
      }
      
      // --- 新增：將 folderId 和 caption 加入 formData ---
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
