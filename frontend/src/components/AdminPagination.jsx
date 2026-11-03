function AdminPagination({ data, text, onPage, label = text.records }) {
    const first = data.total && data.records.length ? (data.page - 1) * data.page_size + 1 : 0;
    const last = first ? first + data.records.length - 1 : 0;
    return (
        <nav className="admin-pagination" aria-label={text.pagination}>
            <p role="status">{label}: {first}–{last} / {data.total}</p>
            {data.page > 1 && <button type="button" className="secondary-button" onClick={function firstPage() { onPage(1); }}>{text.firstPage}</button>}
            <button type="button" className="secondary-button" disabled={data.page <= 1}
                onClick={function previousPage() { onPage(data.page - 1); }}>{text.previous}</button>
            <button type="button" className="secondary-button" disabled={data.page * data.page_size >= data.total}
                onClick={function nextPage() { onPage(data.page + 1); }}>{text.next}</button>
        </nav>
    );
}

export default AdminPagination;
