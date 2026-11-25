export async function finishDownload(
    result: {success:boolean; confirmedIds:string[]},
    total:number,
    autoTrash:boolean,
    trashPhotos:(ids:string[])=>Promise<number>,
    showToast:(message:string,type?:'success'|'error'|'info')=>void
): Promise<number> {
    let moved=0;
    if (autoTrash && result.confirmedIds.length) {
        try { moved=await trashPhotos(result.confirmedIds); }
        catch { showToast('ดาวน์โหลดสำเร็จบางส่วนหรือทั้งหมด แต่ย้ายไปถังขยะไม่สำเร็จ ภาพเดิมยังอยู่','error'); return 0; }
    }
    if (!result.success) {
        showToast(result.confirmedIds.length ? `ดาวน์โหลดสำเร็จ ${result.confirmedIds.length}/${total} รูป${moved?' · ย้ายไปถังขยะ '+moved+' รูป':''}` : 'ดาวน์โหลดไม่สำเร็จ','error');
    } else {
        showToast(`ดาวน์โหลด ${total} รูปแล้ว${moved?' · ย้ายไปถังขยะแล้ว':''}`,'success');
        if (autoTrash && result.confirmedIds.length < total) showToast('เบราว์เซอร์ไม่สามารถยืนยันการบันทึกไฟล์ได้ จึงเก็บภาพต้นฉบับไว้','info');
    }
    return moved;
}
