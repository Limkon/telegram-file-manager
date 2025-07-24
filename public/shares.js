document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('sharesTableBody');
    const table = document.getElementById('sharesTable');
    const loadingMessage = document.getElementById('loading-message');

    const loadSharedFiles = async () => {
        try {
            const response = await axios.get('/api/shared-files');
            const files = response.data;

            loadingMessage.style.display = 'none';
            table.style.display = 'table';
            tableBody.innerHTML = '';

            if (files.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">目前沒有任何分享中的文件。</td></tr>';
                return;
            }

            files.forEach(file => {
                const expires = file.share_expires_at 
                    ? new Date(file.share_expires_at).toLocaleString() 
                    : '永久';
                
                const row = document.createElement('tr');
                row.dataset.messageId = file.message_id;
                row.innerHTML = `
                    <td class="file-name" title="${file.fileName}">${file.fileName}</td>
                    <td>
                        <div class="share-link">
                            <input type="text" value="${file.share_url}" readonly>
                            <button class="copy-btn" title="複製連結"><i class="fas fa-copy"></i></button>
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
            loadingMessage.textContent = '加載失敗，請稍後重試。';
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
            if (!confirm('確定要取消這個文件的分享嗎？')) return;
            
            const row = cancelBtn.closest('tr');
            const messageId = row.dataset.messageId;
            
            try {
                await axios.post('/api/cancel-share', { messageId });
                row.remove();
            } catch (error) {
                alert('取消分享失敗，請重試。');
            }
        }
    });

    loadSharedFiles();
});
