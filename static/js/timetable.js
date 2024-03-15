$(document).ready(function() {
    
    let d1 = timetable.d1;
    let d2 = timetable.d2;
    let d3 = timetable.d3;
    let d4 = timetable.d4;
    let d5 = timetable.d5;

    $('.slot').on("dblclick", function() {
        $(this).toggleClass('accent-green-gradient');
        $('#btn').attr('disabled', false);
    });
    

    $('.d1').each(function(i) {
        if (d1[i] === 1) {
            $(this).addClass('accent-green-gradient');
        }
    });
    $('.d2').each(function(i) {
        if (d2[i] === 1) {
            $(this).addClass('accent-green-gradient');
        }
    });
    $('.d3').each(function(i) {
        if (d3[i] === 1) {
            $(this).addClass('accent-green-gradient');
        }
    });
    $('.d4').each(function(i) {
        if (d4[i] === 1) {
            $(this).addClass('accent-green-gradient');
        }
    });
    $('.d5').each(function(i) {
        if (d5[i] === 1) {
            $(this).addClass('accent-green-gradient');
        }
    });
});

function update() {
    //multidimensional array to store the timetable
    let timetable = [];
    let d1 = [];
    let d2 = [];
    let d3 = [];
    let d4 = [];
    let d5 = [];

    $('.slot').each(function() {
        if ($(this).hasClass('d1')) {
            if ($(this).hasClass('accent-green-gradient')) {
                d1.push(1);
            } else {
                d1.push(0);
            }
        } else if ($(this).hasClass('d2')) {
            if ($(this).hasClass('accent-green-gradient')) {
                d2.push(1);
            } else {
                d2.push(0);
            }
        }
        else if ($(this).hasClass('d3')) {
            if ($(this).hasClass('accent-green-gradient')) {
                d3.push(1);
            } else {
                d3.push(0);
            }
        }
        else if ($(this).hasClass('d4')) {
            if ($(this).hasClass('accent-green-gradient')) {
                d4.push(1);
            } else {
                d4.push(0);
            }
        }
        else if ($(this).hasClass('d5')) {
            if ($(this).hasClass('accent-green-gradient')) {
                d5.push(1);
            } else {
                d5.push(0);
            }
        }
        timetable = [d1, d2, d3, d4, d5];
    });
    //disabling the button
    $('#btn').attr('disabled', true);
    
    //post this to /timetable
    $.ajax({
        url: '/timetable',
        type: 'POST',
        contentType: 'application/json',
        withCredentials: true,
        data: JSON.stringify({
            timetable: timetable
        }),
        success: function(data) {
            if (data.status === 'success') {
                swal({
                    title: "Success",
                    text: "Timetable updated successfully",
                    type: "success",
                })
                $('#btn').attr('disabled', false);
            } else {
                swal({
                    title: "Error",
                    text: data.message,
                    type: "error",
                })
                $('#btn').attr('disabled', false);
            }
        }
    });
}

