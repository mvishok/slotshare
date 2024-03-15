function accent(percentage){
     /* available accent colors */
  /* cyan, blue, purple, pink, orange, green */
   //class name format: accent-<color>-gradient
   //if percentage 100, then green, less than 20, blue, less than 40, purple, less than 60, pink, less than 80, orange 
   let color = 'green';
   if(percentage < 20){
      color = 'blue';
   }
   else if(percentage < 40){
      color = 'purple';
   }
   else if(percentage < 60){
      color = 'pink';
   }
   else if(percentage < 80){
      color = 'orange';
   }
   console.log('accent-'+color+'-gradient', percentage);
   return 'accent-'+color+'-gradient';
}

$(document).ready(()=>{
  
    $('#open-sidebar').click(()=>{
       
        // add class active on #sidebar
        $('#sidebar').addClass('active');
        
        // show sidebar overlay
        $('#sidebar-overlay').removeClass('d-none');
      
     });
    
    
     $('#sidebar-overlay').click(function(){
       
        // add class active on #sidebar
        $('#sidebar').removeClass('active');
        
        // show sidebar overlay
        $(this).addClass('d-none');
      
     });

   let d1 = timetable[0];
   let d2 = timetable[1];
   let d3 = timetable[2];
   let d4 = timetable[3];
   let d5 = timetable[4];

   $('.d1').each(function(i) {
      //use percentage to determine accent color
      $(this).addClass(accent(d1[i]));
      //append a span with the percentage
      $(this).append('<span class="percentage">'+d1[i]+'%</span>');
   });
   $('.d2').each(function(i) {
      $(this).addClass(accent(d2[i]));
      $(this).append('<span class="percentage">'+d2[i]+'%</span>');
   });
   $('.d3').each(function(i) {
      $(this).addClass(accent(d3[i]));
      $(this).append('<span class="percentage">'+d3[i]+'%</span>');
   });
   $('.d4').each(function(i) {
      $(this).addClass(accent(d4[i]));
      $(this).append('<span class="percentage">'+d4[i]+'%</span>');
   });
   $('.d5').each(function(i) {
      $(this).addClass(accent(d5[i]));
      $(this).append('<span class="percentage">'+d5[i]+'%</span>');
   });
});