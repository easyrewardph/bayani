$(document).ready(function(){
    if($('.custom_selector_qty').length != 0){
        if($('#o_wsale_apply_grid')[0].checked == true){
            $('.custom_selector_qty').addClass('d-none');
        }
        if($('#o_wsale_apply_list')[0].checked == true){
            $('.custom_selector_qty').removeClass('d-none')
        }
    }
   $('#o_wsale_apply_grid').change(function(){
        if($('#o_wsale_apply_grid')[0].checked == true){
            $('.custom_selector_qty').addClass('d-none');
        }
   })
   $('#o_wsale_apply_list').change(function(){
        if($('#o_wsale_apply_list')[0].checked == true){
            $('.custom_selector_qty').removeClass('d-none')
        }
   })
})