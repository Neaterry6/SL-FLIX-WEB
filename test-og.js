const subjectId = '4252608531620414856';
const apiUrl = `https://h5-api.aoneroom.com/wefeed-h5api-bff/detail?subjectId=${subjectId}`;
fetch(apiUrl, {
    headers: { 'Origin': 'https://moviebox.ph', 'Referer': 'https://moviebox.ph/' }
}).then(res => res.json()).then(data => console.log(data)).catch(console.error);
