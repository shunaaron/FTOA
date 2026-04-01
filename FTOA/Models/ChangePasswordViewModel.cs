using System.ComponentModel.DataAnnotations;

namespace FTOA.Models
{
    public class ChangePasswordViewModel
    {
        [Required(ErrorMessage = "請輸入目前密碼")]
        [DataType(DataType.Password)]
        [Display(Name = "目前密碼")]
        public string OldPassword { get; set; }

        [Required(ErrorMessage = "請輸入新密碼")]
        [StringLength(100, ErrorMessage = "{0} 長度至少必須為 {2} 個字元。", MinimumLength = 6)]
        [DataType(DataType.Password)]
        [Display(Name = "新密碼")]
        public string NewPassword { get; set; }

        [DataType(DataType.Password)]
        [Display(Name = "確認新密碼")]
        [Compare("NewPassword", ErrorMessage = "新密碼與確認密碼不相符。")]
        public string ConfirmPassword { get; set; }
    }
}
