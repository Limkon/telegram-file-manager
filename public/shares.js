document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('sharesTableBody');
    const table = document.getElementById('sharesTable');
    const loadingMessage = document.getElementById('loading-message');

    const loadSharedFiles = async () => {
        try {
            const response = await axios.get('/api/shares');
            const shares = response.data;

            loadingMessage.style.display = 'none';
            table.style.display = 'table';
            tableBody.innerHTML = '';

            if (shares.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">目前没有任何分享中的项目。</td></tr>';
                return;
            }

            shares.forEach(item => {
                const expires = item.share_expires_at 
                    ? new Date(item.share_expires_at).toLocaleString() 
                    : '永久';
                
                const row = document.createElement('tr');
                row.dataset.itemId = item.id;
                row.dataset.itemType = item.type;
                
                const icon = item.type === 'folder' ? 'fa-folder' : 'fa-file';
                
                row.innerHTML = `
                    <td class="file-name" title="${item.name}"><i class="fas ${icon}" style="margin-right: 8px;"></i>${item.name}</td>
                    <td>
                        <div class="share-link">
                            <input type="text" value="${item.share_url}" readonly>
                            <button class="copy-btn" title="复制连结"><i class="fas fa-copy"></i></button>
                        </div>
                    </td>
                    <td>${expires}</td>
                    <td>
                        <button class="cancel-btn" title="取消分享"><i class="fas fa-times"></i> 取消</button>
                    </td>
                `;
                tableBody.appendChild(row);
            });
        } catch (error) {
            loadingMessage.textContent = '加载失败，请稍后重试。';
        }
    };

    tableBody.addEventListener('click', async (e) => {
        const copyBtn = e.target.closest('.copy-btn');
        const cancelBtn = e.target.closest('.cancel-btn');

        if (copyBtn) {
            const input = copyBtn.previousElementSibling;
            navigator.clipboard.writeText(input.value).then(() => {
                const originalIcon = copyBtn.innerHTML;
                copyBtn.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => { copyBtn.innerHTML = originalIcon; }, 2000);
            });
        }

        if (cancelBtn) {
            if (!confirm('确定要取消这个项目的分享吗？')) return;
            
            const row = cancelBtn.closest('tr');
            const itemId = row.dataset.itemId;
            const itemType = row.dataset.itemType;
            
            try {
                await axios.post('/api/cancel-share', { itemId, itemType });
                row.remove();
            } catch (error) {
                alert('取消分享失败，请重试。');
            }
        }
    });

    loadSharedFiles();
});
